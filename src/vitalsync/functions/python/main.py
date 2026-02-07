# ══════════════════════════════════════════════════════
# VITALSYNC — Cloud Functions (Python)
# Garmin sync via Garth + Claude AI analysis
# ══════════════════════════════════════════════════════

import json
import os
import base64
from datetime import date, timedelta, datetime

import garth
from garminconnect import Garmin
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from firebase_functions import https_fn, scheduler_fn, options
from firebase_admin import initialize_app, firestore, auth as fb_auth
import google.cloud.firestore

# ── Initialise Firebase Admin ──
initialize_app()
db = firestore.client()

# ── Region: London ──
REGION = options.SupportedRegion.EUROPE_WEST2

# ── Secrets ──
GARMIN_KEY_SECRET = options.SecretParam('GARMIN_ENCRYPTION_KEY')


# ══════════════════════════════════════════════════════
# ENCRYPTION HELPERS
# ══════════════════════════════════════════════════════

def _get_encryption_key() -> bytes:
    """Load AES-256 key from environment (set via Secret Manager)."""
    key_hex = os.environ.get('GARMIN_ENCRYPTION_KEY', '')
    if not key_hex:
        raise ValueError('GARMIN_ENCRYPTION_KEY not set — configure via Secret Manager')
    return bytes.fromhex(key_hex)


def encrypt(plaintext: str) -> str:
    """AES-256-GCM encrypt → base64 string."""
    nonce = os.urandom(12)
    aesgcm = AESGCM(_get_encryption_key())
    ct = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)
    return base64.b64encode(nonce + ct).decode('utf-8')


def decrypt(ciphertext: str) -> str:
    """base64 string → AES-256-GCM decrypt."""
    raw = base64.b64decode(ciphertext)
    nonce, ct = raw[:12], raw[12:]
    aesgcm = AESGCM(_get_encryption_key())
    return aesgcm.decrypt(nonce, ct, None).decode('utf-8')


# ══════════════════════════════════════════════════════
# GARMIN CLIENT HELPERS
# ══════════════════════════════════════════════════════

def _restore_client(uid: str) -> Garmin:
    """Restore a Garmin client from encrypted Firestore session."""
    settings = db.document(f'users/{uid}').get().to_dict()
    garmin_cfg = settings.get('garmin', {})

    if not garmin_cfg.get('connected'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='Garmin not connected',
        )

    session_json = decrypt(garmin_cfg['garthSession'])
    garth.resume(session_json)

    client = Garmin()
    client.garth = garth.client
    return client


def _save_session(uid: str):
    """Persist the (possibly refreshed) Garth session back to Firestore."""
    db.document(f'users/{uid}').set({
        'garmin': {
            'garthSession': encrypt(garth.client.dumps()),
            'lastSyncAt': firestore.SERVER_TIMESTAMP,
        }
    }, merge=True)


def _safe_call(fn, *args, default=None):
    """Call a Garmin API method, returning default on error."""
    try:
        return fn(*args)
    except Exception:
        return default


# ══════════════════════════════════════════════════════
# GARMIN LOGIN
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, memory=options.MemoryOption.GB_1, timeout_sec=540, secrets=[GARMIN_KEY_SECRET])
def garmin_login(req: https_fn.CallableRequest) -> dict:
    """Authenticate with Garmin Connect via Garth (same flow as mobile app)."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    email = req.data.get('email', '')
    password = req.data.get('password', '')
    if not email or not password:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='Email and password required',
        )

    try:
        garth.login(email, password)

        # Verify by fetching profile
        client = Garmin()
        client.garth = garth.client
        display_name = client.get_full_name()

        # Persist encrypted session (login only — no data sync here)
        db.document(f'users/{uid}').set({
            'garmin': {
                'connected': True,
                'garthSession': encrypt(garth.client.dumps()),
                'garminEmail': encrypt(email),
                'connectedAt': firestore.SERVER_TIMESTAMP,
                'lastSyncAt': None,
                'backfillStatus': 'pending',
                'backfillProgress': 0,
                'displayName': display_name,
            }
        }, merge=True)

        return {'status': 'connected', 'displayName': display_name}

    except Exception as e:
        msg = str(e)
        if 'MFA' in msg or 'mfa' in msg:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                message='Garmin MFA required — please disable MFA or provide code',
            )
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message=f'Garmin login failed: {msg}',
        )


# ══════════════════════════════════════════════════════
# GARMIN DISCONNECT
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, secrets=[GARMIN_KEY_SECRET])
def garmin_disconnect(req: https_fn.CallableRequest) -> dict:
    """Disconnect Garmin — remove tokens but keep historical data."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    db.document(f'users/{uid}').set({
        'garmin': {
            'connected': False,
            'garthSession': firestore.DELETE_FIELD,
            'garminEmail': firestore.DELETE_FIELD,
            'disconnectedAt': firestore.SERVER_TIMESTAMP,
        }
    }, merge=True)

    return {'status': 'disconnected'}


# ══════════════════════════════════════════════════════
# GARMIN DATA SYNC — CORE PULL LOGIC
# ══════════════════════════════════════════════════════

def _do_sync(uid: str, client: Garmin, backfill_days: int = 1):
    """
    Pull Garmin data for the last N days and write to Firestore.
    backfill_days=1 for daily sync, 30 for initial, 730 for full backfill.
    """
    today = date.today()
    batch = db.batch()
    write_count = 0

    for i in range(backfill_days):
        d = today - timedelta(days=i)
        ds = d.isoformat()

        daily = {
            'date': ds,
            'stats': _safe_call(client.get_stats, ds, default={}),
            'heartRates': _safe_call(client.get_heart_rates, ds, default={}),
            'sleep': _safe_call(client.get_sleep_data, ds, default={}),
            'stress': _safe_call(client.get_stress_data, ds, default={}),
            'bodyComp': _safe_call(client.get_body_composition, ds, default={}),
            'hrv': _safe_call(client.get_hrv_data, ds, default={}),
            'spo2': _safe_call(client.get_spo2_data, ds, default={}),
            'respiration': _safe_call(client.get_respiration_data, ds, default={}),
            'trainingReadiness': _safe_call(client.get_training_readiness, ds, default={}),
            'processedAt': firestore.SERVER_TIMESTAMP,
            'source': 'garmin_pull',
        }

        ref = db.document(f'users/{uid}/garminDailies/{ds}')
        batch.set(ref, daily, merge=True)
        write_count += 1

        # Firestore batch limit = 500
        if write_count >= 450:
            batch.commit()
            batch = db.batch()
            write_count = 0

    # Sync recent activities (last 20)
    activities = _safe_call(client.get_activities, 0, 20, default=[])
    for act in (activities or []):
        act_id = str(act.get('activityId', ''))
        if act_id:
            ref = db.document(f'users/{uid}/activities/{act_id}')
            act['processedAt'] = firestore.SERVER_TIMESTAMP
            act['source'] = 'garmin_pull'
            batch.set(ref, act, merge=True)
            write_count += 1

            if write_count >= 450:
                batch.commit()
                batch = db.batch()
                write_count = 0

    if write_count > 0:
        batch.commit()


# ══════════════════════════════════════════════════════
# GARMIN SYNC — ON-DEMAND (user opens app)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, memory=options.MemoryOption.MB_512, secrets=[GARMIN_KEY_SECRET])
def garmin_sync_on_demand(req: https_fn.CallableRequest) -> dict:
    """Pull latest Garmin data when user opens the app."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    client = _restore_client(uid)
    _do_sync(uid, client, backfill_days=2)  # Today + yesterday
    _save_session(uid)

    return {'status': 'ok', 'syncedAt': datetime.utcnow().isoformat()}


# ══════════════════════════════════════════════════════
# GARMIN SYNC — SCHEDULED (every 15 minutes)
# ══════════════════════════════════════════════════════

@scheduler_fn.on_schedule(
    schedule='every 15 minutes',
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=540,
    secrets=[GARMIN_KEY_SECRET],
)
def garmin_scheduled_sync(event: scheduler_fn.ScheduledEvent) -> None:
    """Sync all connected Garmin users every 15 minutes."""
    # Query all users with garmin.connected == true
    users_ref = db.collection('users').where(
        filter=google.cloud.firestore.FieldFilter('garmin.connected', '==', True)
    )

    for user_doc in users_ref.stream():
        uid = user_doc.id
        try:
            client = _restore_client(uid)
            _do_sync(uid, client, backfill_days=1)
            _save_session(uid)
        except Exception as e:
            print(f'Sync failed for {uid}: {e}')
            # Don't fail the whole batch — continue to next user


# ══════════════════════════════════════════════════════
# GARMIN BACKFILL — DEEP HISTORY
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.GB_1,
    timeout_sec=540,
    secrets=[GARMIN_KEY_SECRET],
)
def garmin_backfill(req: https_fn.CallableRequest) -> dict:
    """
    Pull extended historical data. Called after initial connection.
    Chunks into manageable pieces to stay within function timeout.
    """
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    days_back = req.data.get('daysBack', 365)  # Default 1 year
    start_offset = req.data.get('startOffset', 0)  # For pagination
    chunk_size = 60  # Process 60 days per invocation (within 9-min timeout)

    client = _restore_client(uid)

    actual_start = start_offset
    actual_end = min(start_offset + chunk_size, days_back)

    today = date.today()
    batch = db.batch()
    write_count = 0

    for i in range(actual_start, actual_end):
        d = today - timedelta(days=i)
        ds = d.isoformat()

        daily = {
            'date': ds,
            'stats': _safe_call(client.get_stats, ds, default={}),
            'heartRates': _safe_call(client.get_heart_rates, ds, default={}),
            'sleep': _safe_call(client.get_sleep_data, ds, default={}),
            'stress': _safe_call(client.get_stress_data, ds, default={}),
            'bodyComp': _safe_call(client.get_body_composition, ds, default={}),
            'hrv': _safe_call(client.get_hrv_data, ds, default={}),
            'spo2': _safe_call(client.get_spo2_data, ds, default={}),
            'respiration': _safe_call(client.get_respiration_data, ds, default={}),
            'processedAt': firestore.SERVER_TIMESTAMP,
            'source': 'garmin_backfill',
        }

        ref = db.document(f'users/{uid}/garminDailies/{ds}')
        batch.set(ref, daily, merge=True)
        write_count += 1

        if write_count >= 450:
            batch.commit()
            batch = db.batch()
            write_count = 0

    if write_count > 0:
        batch.commit()

    # Backfill activities for this period too
    all_activities = []
    page = 0
    while True:
        acts = _safe_call(client.get_activities, page * 50, 50, default=[])
        if not acts:
            break
        all_activities.extend(acts)
        page += 1
        if page > 40:  # Safety: max 2000 activities
            break

    act_batch = db.batch()
    act_count = 0
    for act in all_activities:
        act_id = str(act.get('activityId', ''))
        if act_id:
            ref = db.document(f'users/{uid}/activities/{act_id}')
            act['processedAt'] = firestore.SERVER_TIMESTAMP
            act['source'] = 'garmin_backfill'
            act_batch.set(ref, act, merge=True)
            act_count += 1
            if act_count >= 450:
                act_batch.commit()
                act_batch = db.batch()
                act_count = 0

    if act_count > 0:
        act_batch.commit()

    _save_session(uid)

    # Update backfill progress
    progress = min(95, round((actual_end / max(1, days_back)) * 100))
    db.document(f'users/{uid}').set({
        'garmin': {'backfillProgress': progress}
    }, merge=True)

    has_more = actual_end < days_back

    if not has_more:
        db.document(f'users/{uid}').set({
            'garmin': {
                'backfillStatus': 'complete',
                'backfillProgress': 100,
            }
        }, merge=True)

    return {
        'status': 'ok',
        'daysProcessed': actual_end - actual_start,
        'totalActivities': len(all_activities),
        'progress': progress,
        'hasMore': has_more,
        'nextOffset': actual_end if has_more else None,
    }


# ══════════════════════════════════════════════════════
# USER DATA DELETION (GDPR)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, timeout_sec=300, secrets=[GARMIN_KEY_SECRET])
def delete_user_data(req: https_fn.CallableRequest) -> dict:
    """GDPR right to deletion — remove all user data."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    subcollections = [
        'activities', 'healthLog', 'interventions', 'trainingPlans',
        'garminDailies', 'garminSleep', 'activityStats', 'trends',
        'backfillJobs', 'promptState',
    ]

    for sub in subcollections:
        _delete_collection(f'users/{uid}/{sub}')

    # Delete settings document
    db.document(f'users/{uid}').delete()

    # Delete Firebase Auth account
    try:
        fb_auth.delete_user(uid)
    except Exception as e:
        print(f'Auth deletion failed: {e}')

    # Anonymised audit trail
    db.collection('auditLog').add({
        'action': 'user_deletion',
        'timestamp': firestore.SERVER_TIMESTAMP,
    })

    return {'status': 'deleted'}


def _delete_collection(path: str, batch_size: int = 100):
    """Delete all documents in a Firestore collection."""
    coll_ref = db.collection(path)
    while True:
        docs = list(coll_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = db.batch()
        for d in docs:
            batch.delete(d.reference)
        batch.commit()


# ══════════════════════════════════════════════════════
# AI — SECRETS & CLIENT
# ══════════════════════════════════════════════════════

ANTHROPIC_KEY_SECRET = options.SecretParam('ANTHROPIC_API_KEY')

DAILY_ANALYSIS_PROMPT = """You are a personal health and fitness analyst. You receive comprehensive health
data from a Garmin wearable and manually logged health metrics. Your role is to:

1. ANALYSE the data for patterns, concerns, and opportunities
2. GENERATE 2-4 prioritised interventions for today
3. ADJUST the current training plan if needed based on recovery metrics

CRITICAL RULES:
- Never diagnose medical conditions. Flag concerning trends for doctor review.
- Blood pressure > 140/90 or < 90/60 → always flag as high priority
- Resting HR change > 10bpm from baseline → flag recovery concern
- HRV declining 3+ days → suggest recovery day
- Sleep score < 60 for 3+ nights → prioritise sleep interventions
- Body battery < 25 at morning → suggest light activity only
- Training readiness score drives today's training intensity

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "dailySummary": "Brief overview of health status today",
  "interventions": [
    {
      "category": "training|recovery|nutrition|sleep|stress|health_alert",
      "priority": "high|medium|low",
      "title": "Short actionable title",
      "summary": "One-line summary",
      "detail": "Detailed recommendation with specific actions",
      "reasoning": "What data drove this recommendation",
      "actions": ["Specific step 1", "Specific step 2"]
    }
  ]
}"""

WEEKLY_PLAN_PROMPT = """You are an expert running and fitness coach creating a personalised weekly
training plan. You receive user profile, recent training data, Garmin metrics, and availability constraints.

PRINCIPLES:
- Progressive overload: max 10% volume increase per week
- Respect recovery: use HRV, training readiness, and sleep data
- NEVER exceed the user's stated availability for any day
- NEVER schedule on designated rest days
- Total planned hours MUST be ≤ totalHoursPerWeek budget
- Include warm-up and cool-down in every session
- For runners: 80/20 rule (80% easy, 20% hard effort)

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "weekSummary": "Overview and focus for this week",
  "focusAreas": ["endurance", "speed", "recovery"],
  "totalPlannedMinutes": 540,
  "sessions": [
    {
      "day": "monday",
      "slot": "morning",
      "type": "run|cycle|swim|strength|yoga|rest|active_recovery",
      "title": "Short title",
      "description": "What to do",
      "durationMinutes": 40,
      "intensityLevel": "easy|moderate|hard|max",
      "warmUp": "5 min walk, dynamic stretches",
      "mainSet": "Description of main workout",
      "coolDown": "5 min walk, static stretches"
    }
  ]
}"""


def _get_anthropic_client():
    """Create Anthropic client from secret."""
    import anthropic
    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        raise ValueError('ANTHROPIC_API_KEY not set')
    return anthropic.Anthropic(api_key=api_key)


def _build_daily_context(uid: str) -> dict:
    """Gather comprehensive health context for AI analysis."""
    today_str = date.today().isoformat()
    week_ago = (date.today() - timedelta(days=7)).isoformat()

    # User settings
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}

    # Today's Garmin data
    today_snap = db.document(f'users/{uid}/garminDailies/{today_str}').get()
    today_data = today_snap.to_dict() if today_snap.exists else {}

    # 7-day Garmin history
    week_data = []
    for i in range(7):
        d = (date.today() - timedelta(days=i)).isoformat()
        snap = db.document(f'users/{uid}/garminDailies/{d}').get()
        if snap.exists:
            week_data.append(snap.to_dict())

    # Recent health log entries (last 30 days)
    health_entries = []
    health_q = db.collection(f'users/{uid}/healthLog').order_by(
        'date', direction='DESCENDING'
    ).limit(20)
    for doc_snap in health_q.stream():
        health_entries.append(doc_snap.to_dict())

    # Recent activities
    activities = []
    act_q = db.collection(f'users/{uid}/activities').order_by(
        'date', direction='DESCENDING'
    ).limit(10)
    for doc_snap in act_q.stream():
        d = doc_snap.to_dict()
        # Strip large fields to reduce token count
        for key in ['samples', 'laps', 'splits', 'geoPolylineDTO']:
            d.pop(key, None)
        activities.append(d)

    return {
        'currentDate': today_str,
        'dayOfWeek': date.today().strftime('%A'),
        'user': {
            'goals': user_doc.get('goals', {}),
            'availability': user_doc.get('availability', {}),
            'profile': user_doc.get('profile', {}),
            'healthContext': user_doc.get('healthContext', {}),
        },
        'today': today_data,
        'weekHistory': week_data,
        'healthLog': health_entries,
        'recentActivities': activities,
    }


def _parse_ai_json(text: str) -> dict:
    """Extract JSON from Claude response, handling markdown fences."""
    text = text.strip()
    if text.startswith('```'):
        # Remove markdown code fences
        lines = text.split('\n')
        lines = [l for l in lines if not l.strip().startswith('```')]
        text = '\n'.join(lines)
    return json.loads(text)


# ══════════════════════════════════════════════════════
# AI DAILY ANALYSIS
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_daily_analysis(req: https_fn.CallableRequest) -> dict:
    """Run AI daily health analysis for a user."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    context = _build_daily_context(uid)
    client = _get_anthropic_client()

    response = client.messages.create(
        model='claude-sonnet-4-20250514',
        max_tokens=2000,
        system=DAILY_ANALYSIS_PROMPT,
        messages=[{'role': 'user', 'content': json.dumps(context)}],
    )

    result = _parse_ai_json(response.content[0].text)

    # Store interventions
    interventions = result.get('interventions', [])
    batch = db.batch()
    for interv in interventions:
        ref = db.collection(f'users/{uid}/interventions').document()
        batch.set(ref, {
            **interv,
            'actionItems': interv.get('actions', []),
            'status': 'active',
            'period': 'daily',
            'createdAt': firestore.SERVER_TIMESTAMP,
            'generatedBy': 'claude-sonnet-4-20250514',
        })
    batch.commit()

    return {
        'status': 'ok',
        'summary': result.get('dailySummary', ''),
        'interventionCount': len(interventions),
    }


# ══════════════════════════════════════════════════════
# AI WEEKLY TRAINING PLAN
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_weekly_plan(req: https_fn.CallableRequest) -> dict:
    """Generate AI weekly training plan."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    context = _build_daily_context(uid)
    client = _get_anthropic_client()

    response = client.messages.create(
        model='claude-sonnet-4-20250514',
        max_tokens=3000,
        system=WEEKLY_PLAN_PROMPT,
        messages=[{'role': 'user', 'content': json.dumps(context)}],
    )

    result = _parse_ai_json(response.content[0].text)

    # Store training plan
    today = date.today()
    # Find next Monday
    days_until_monday = (7 - today.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    week_start = today + timedelta(days=days_until_monday)
    week_end = week_start + timedelta(days=6)

    sessions = result.get('sessions', [])
    for s in sessions:
        s['completed'] = False

    plan_ref = db.collection(f'users/{uid}/trainingPlans').document()
    plan_ref.set({
        'weekStartDate': week_start.isoformat(),
        'weekEndDate': week_end.isoformat(),
        'status': 'active',
        'summary': result.get('weekSummary', ''),
        'focusAreas': result.get('focusAreas', []),
        'totalPlannedMinutes': result.get('totalPlannedMinutes', 0),
        'sessions': sessions,
        'createdAt': firestore.SERVER_TIMESTAMP,
        'generatedBy': 'claude-sonnet-4-20250514',
    })

    return {
        'status': 'ok',
        'planId': plan_ref.id,
        'sessionCount': len(sessions),
        'summary': result.get('weekSummary', ''),
    }


# ══════════════════════════════════════════════════════
# AI ON-DEMAND QUERY
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_on_demand(req: https_fn.CallableRequest) -> dict:
    """Answer ad-hoc health/fitness questions with user context."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    question = req.data.get('question', '')
    if not question:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='Question is required',
        )

    context = _build_daily_context(uid)
    client = _get_anthropic_client()

    response = client.messages.create(
        model='claude-sonnet-4-20250514',
        max_tokens=1500,
        system="""You are a personal health and fitness assistant. You have access to the user's
Garmin wearable data and health logs. Answer their question using this data.
Be concise, specific, and actionable. Never diagnose medical conditions.
If asked about concerning symptoms, recommend consulting a doctor.""",
        messages=[
            {'role': 'user', 'content': f'My health data:\n{json.dumps(context)}\n\nQuestion: {question}'},
        ],
    )

    return {
        'status': 'ok',
        'answer': response.content[0].text,
    }


# ══════════════════════════════════════════════════════
# COMPUTE ACTIVITY STATS (Phase 9)
# ══════════════════════════════════════════════════════

@scheduler_fn.on_schedule(
    schedule='every day 02:00',
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=300,
)
def compute_activity_stats(event: scheduler_fn.ScheduledEvent) -> None:
    """Nightly aggregation of activity stats per user."""
    users_ref = db.collection('users')

    for user_doc in users_ref.stream():
        uid = user_doc.id
        try:
            _compute_weekly_stats(uid)
        except Exception as e:
            print(f'Stats computation failed for {uid}: {e}')


def _compute_weekly_stats(uid: str):
    """Compute weekly activity stats for a user."""
    today = date.today()
    # Current week (Mon-Sun)
    days_since_monday = today.weekday()
    week_start = today - timedelta(days=days_since_monday)
    week_end = week_start + timedelta(days=6)
    period_key = f'week_{week_start.isoformat()}'

    # Fetch activities for this week
    activities = []
    act_q = db.collection(f'users/{uid}/activities').order_by('date', direction='DESCENDING').limit(50)
    for doc_snap in act_q.stream():
        act = doc_snap.to_dict()
        act_date_str = (act.get('startTimeLocal') or act.get('date', ''))[:10]
        if act_date_str and week_start.isoformat() <= act_date_str <= week_end.isoformat():
            activities.append(act)

    total_duration = sum(a.get('duration', a.get('movingDuration', 0)) or 0 for a in activities)
    total_distance = sum(a.get('distance', 0) or 0 for a in activities)
    total_calories = sum(a.get('calories', a.get('activeKilocalories', 0)) or 0 for a in activities)

    # By sport type
    by_type = {}
    for act in activities:
        t = act.get('activityType', {}).get('typeKey', 'other') if isinstance(act.get('activityType'), dict) else 'other'
        if t not in by_type:
            by_type[t] = {'count': 0, 'duration': 0, 'distance': 0}
        by_type[t]['count'] += 1
        by_type[t]['duration'] += (act.get('duration', act.get('movingDuration', 0)) or 0)
        by_type[t]['distance'] += (act.get('distance', 0) or 0)

    db.document(f'users/{uid}/activityStats/{period_key}').set({
        'periodType': 'week',
        'periodStart': week_start.isoformat(),
        'periodEnd': week_end.isoformat(),
        'activityCount': len(activities),
        'totalDurationSeconds': total_duration,
        'totalDistanceMeters': total_distance,
        'totalCalories': total_calories,
        'byType': by_type,
        'computedAt': firestore.SERVER_TIMESTAMP,
    }, merge=True)


# ══════════════════════════════════════════════════════
# DATA EXPORT (Phase 10)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, timeout_sec=300)
def data_export(req: https_fn.CallableRequest) -> dict:
    """Export all user data as JSON (GDPR right to access)."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    export = {'exportedAt': datetime.utcnow().isoformat(), 'userId': uid}

    # User settings (excluding encrypted fields)
    user_doc = db.document(f'users/{uid}').get()
    if user_doc.exists:
        settings = user_doc.to_dict()
        # Remove encrypted credentials
        garmin = settings.get('garmin', {})
        garmin.pop('garthSession', None)
        garmin.pop('garminEmail', None)
        settings['garmin'] = garmin
        export['settings'] = settings

    # Subcollections
    subcollections = [
        'garminDailies', 'activities', 'healthLog',
        'interventions', 'trainingPlans', 'activityStats',
    ]

    for sub in subcollections:
        docs = []
        for doc_snap in db.collection(f'users/{uid}/{sub}').stream():
            d = doc_snap.to_dict()
            d['_id'] = doc_snap.id
            # Convert timestamps to strings for JSON serialization
            for k, v in d.items():
                if hasattr(v, 'isoformat'):
                    d[k] = v.isoformat()
            docs.append(d)
        export[sub] = docs

    return {'status': 'ok', 'data': export}
