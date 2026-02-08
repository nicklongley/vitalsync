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

    encrypted_session = garmin_cfg.get('garthSession')
    if not encrypted_session:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='Garmin session expired — please reconnect in Settings',
        )
    session_json = decrypt(encrypted_session)

    # garth.resume() expects a directory path, not a string.
    # Use garth.client.loads() to restore from a JSON string.
    garth.client.loads(session_json)

    client = Garmin()
    client.garth = garth.client

    # display_name is required for Garmin API URL construction.
    # Without it, API paths contain '/None/' and return 403.
    display_name = garmin_cfg.get('displayName')
    if not display_name:
        try:
            display_name = client.get_full_name()
        except Exception:
            pass
    if not display_name:
        # Fallback: try garth profile fields
        try:
            profile = garth.client.profile
            display_name = profile.get('displayName') or profile.get('userName') or profile.get('fullName')
        except Exception:
            pass
    if not display_name:
        # Last resort: fetch social profile which reliably returns displayName
        try:
            social = client.get_social_profile()
            display_name = social.get('displayName') or social.get('userName')
        except Exception:
            pass
    if not display_name:
        print(f'WARNING: Could not determine display_name for {uid}, API calls may fail')
    client.display_name = display_name
    print(f'Restored client for {uid}, display_name={display_name}')

    # Persist display_name if we found it and it wasn't stored
    if display_name and not garmin_cfg.get('displayName'):
        db.document(f'users/{uid}').set({
            'garmin': {'displayName': display_name}
        }, merge=True)

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
    except Exception as e:
        print(f'API call failed for {fn.__name__}: {e}')
        return default


def _sanitize_for_firestore(data, max_depth=10):
    """
    Strip deeply nested or oversized data that Firestore rejects.
    Firestore has a 20-level nesting limit and 1MB doc limit.
    Also removes large arrays (e.g. per-minute stress values)
    and converts unsupported types (datetime, etc.) to strings.
    Handles NaN, Inf, bytes, and other non-Firestore types.
    """
    import math

    if max_depth <= 0:
        if isinstance(data, (str, int, bool)) or data is None:
            return data
        if isinstance(data, float):
            if math.isnan(data) or math.isinf(data):
                return None
            return data
        return str(data)[:200]

    if isinstance(data, dict):
        result = {}
        for k, v in data.items():
            if isinstance(v, list) and len(v) > 100:
                result[k] = f'[{len(v)} items omitted]'
                continue
            result[k] = _sanitize_for_firestore(v, max_depth - 1)
        return result
    elif isinstance(data, list):
        if len(data) > 100:
            return f'[{len(data)} items omitted]'
        return [_sanitize_for_firestore(item, max_depth - 1) for item in data]
    elif isinstance(data, bool):
        return data
    elif isinstance(data, int):
        return data
    elif isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return None
        return data
    elif isinstance(data, str) or data is None:
        return data
    elif isinstance(data, bytes):
        return data.decode('utf-8', errors='replace')[:500]
    elif isinstance(data, datetime):
        return data.isoformat()
    elif isinstance(data, date):
        return data.isoformat()
    else:
        return str(data)[:500]


# ══════════════════════════════════════════════════════
# GARMIN LOGIN
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, memory=options.MemoryOption.GB_1, timeout_sec=540, secrets=[GARMIN_KEY_SECRET])
def garmin_login(req: https_fn.CallableRequest) -> dict:
    """Authenticate with Garmin Connect via Garth (same flow as mobile app)."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

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
        if not display_name:
            # Fallback: try garth profile or social profile
            try:
                profile = garth.client.profile
                display_name = profile.get('displayName') or profile.get('userName') or profile.get('fullName')
            except Exception:
                pass
        if not display_name:
            try:
                social = client.get_social_profile()
                display_name = social.get('displayName') or social.get('userName')
            except Exception:
                pass
        client.display_name = display_name

        # Persist encrypted session
        db.document(f'users/{uid}').set({
            'garmin': {
                'connected': True,
                'garthSession': encrypt(garth.client.dumps()),
                'garminEmail': encrypt(email),
                'connectedAt': firestore.SERVER_TIMESTAMP,
                'lastSyncAt': None,
                'backfillStatus': 'syncing',
                'backfillProgress': 0,
                'displayName': display_name,
            }
        }, merge=True)

        # Kick off initial sync (first 30 days + today)
        _do_sync(uid, client, backfill_days=30)
        _save_session(uid)

        # Mark initial backfill as complete (30 days done)
        db.document(f'users/{uid}').set({
            'garmin': {
                'backfillStatus': 'complete',
                'backfillProgress': 100,
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
        print(f'Garmin login failed for {uid}: {msg}')
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='Garmin login failed. Please check your credentials and try again.',
        )


# ══════════════════════════════════════════════════════
# GARMIN DISCONNECT
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, secrets=[GARMIN_KEY_SECRET])
def garmin_disconnect(req: https_fn.CallableRequest) -> dict:
    """Disconnect Garmin — remove tokens but keep historical data."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    # Use dot-notation with update() for DELETE_FIELD to work correctly.
    # set(merge=True) with nested dicts replaces the entire nested object,
    # which prevents DELETE_FIELD from working as expected.
    db.document(f'users/{uid}').update({
        'garmin.connected': False,
        'garmin.garthSession': firestore.DELETE_FIELD,
        'garmin.garminEmail': firestore.DELETE_FIELD,
        'garmin.disconnectedAt': firestore.SERVER_TIMESTAMP,
    })

    return {'status': 'disconnected'}


# ══════════════════════════════════════════════════════
# GARMIN DATA SYNC — CORE PULL LOGIC
# ══════════════════════════════════════════════════════

def _do_sync(uid: str, client: Garmin, backfill_days: int = 1):
    """
    Pull Garmin data for the last N days and write to Firestore.
    backfill_days=1 for daily sync, 30 for initial, 730 for full backfill.
    Each daily document is written individually so one bad field
    doesn't block the rest.
    """
    today = date.today()

    for i in range(backfill_days):
        d = today - timedelta(days=i)
        ds = d.isoformat()

        # Fetch each data source individually
        data_sources = {
            'stats': _safe_call(client.get_stats, ds, default={}),
            'heartRates': _safe_call(client.get_heart_rates, ds, default={}),
            'sleep': _safe_call(client.get_sleep_data, ds, default={}),
            'stress': _safe_call(client.get_stress_data, ds, default={}),
            'bodyComp': _safe_call(client.get_body_composition, ds, default={}),
            'hrv': _safe_call(client.get_hrv_data, ds, default={}),
            'spo2': _safe_call(client.get_spo2_data, ds, default={}),
            'respiration': _safe_call(client.get_respiration_data, ds, default={}),
            'trainingReadiness': _safe_call(client.get_training_readiness, ds, default={}),
        }

        ref = db.document(f'users/{uid}/garminDailies/{ds}')

        # Debug: log what we fetched
        for fn, fd in data_sources.items():
            keys = list(fd.keys())[:5] if isinstance(fd, dict) else 'N/A'
            size = len(fd) if hasattr(fd, '__len__') else 0
            print(f'  {ds}/{fn}: {size} keys, sample={keys}')

        # Write each field individually so one bad field doesn't block others
        base = {'date': ds, 'processedAt': firestore.SERVER_TIMESTAMP, 'source': 'garmin_pull'}
        for field_name, field_data in data_sources.items():
            try:
                sanitized = _sanitize_for_firestore(field_data)
                ref.set({**base, field_name: sanitized}, merge=True)
            except Exception as e:
                # If sanitization wasn't enough, force JSON round-trip to strip
                # all non-serializable types, then retry
                try:
                    import json
                    json_safe = json.loads(json.dumps(field_data, default=str))
                    sanitized = _sanitize_for_firestore(json_safe)
                    ref.set({**base, field_name: sanitized}, merge=True)
                except Exception as e2:
                    print(f'Failed to write {field_name} for {ds} (even after JSON round-trip): {e2}')
                    # Last resort: skip this field entirely

    # Sync recent activities (last 20)
    activities = _safe_call(client.get_activities, 0, 20, default=[])
    batch = db.batch()
    write_count = 0
    for act in (activities or []):
        act_id = str(act.get('activityId', ''))
        if act_id:
            try:
                ref = db.document(f'users/{uid}/activities/{act_id}')
                clean_act = _sanitize_for_firestore(act)
                clean_act['processedAt'] = firestore.SERVER_TIMESTAMP
                clean_act['source'] = 'garmin_pull'
                batch.set(ref, clean_act, merge=True)
                write_count += 1

                if write_count >= 450:
                    batch.commit()
                    batch = db.batch()
                    write_count = 0
            except Exception as e:
                print(f'Failed to write activity {act_id}: {e}')

    if write_count > 0:
        batch.commit()


# ══════════════════════════════════════════════════════
# GARMIN SYNC — ON-DEMAND (user opens app)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, memory=options.MemoryOption.MB_512, secrets=[GARMIN_KEY_SECRET])
def garmin_sync_on_demand(req: https_fn.CallableRequest) -> dict:
    """Pull latest Garmin data when user opens the app."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

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
    Pull full activity history from Garmin.
    Paginates through all activities (up to 10,000) and writes to Firestore.
    After activities are saved, computes weekly stats.
    Supports chunked pagination via startPage parameter.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    try:
        start_page = int(req.data.get('startPage', 0))
    except (ValueError, TypeError):
        start_page = 0

    PAGE_SIZE = 100
    MAX_PAGES_PER_CALL = 50  # 5000 activities per invocation (within 9-min timeout)

    client = _restore_client(uid)
    print(f'Backfill started for {uid}, display_name={client.display_name}, startPage={start_page}')

    db.document(f'users/{uid}').set({
        'garmin': {'backfillStatus': 'syncing'}
    }, merge=True)

    total_saved = 0
    page = start_page
    found_activities = True

    while found_activities and page < start_page + MAX_PAGES_PER_CALL:
        print(f'Fetching activities page {page} (offset={page * PAGE_SIZE}, limit={PAGE_SIZE})')
        acts = _safe_call(client.get_activities, page * PAGE_SIZE, PAGE_SIZE, default=[])
        print(f'Got {len(acts) if acts else 0} activities from page {page}')
        if not acts:
            found_activities = False
            break

        batch = db.batch()
        batch_count = 0
        for act in acts:
            act_id = str(act.get('activityId', ''))
            if act_id:
                try:
                    ref = db.document(f'users/{uid}/activities/{act_id}')
                    clean_act = _sanitize_for_firestore(act)
                    clean_act['processedAt'] = firestore.SERVER_TIMESTAMP
                    clean_act['source'] = 'garmin_backfill'
                    batch.set(ref, clean_act, merge=True)
                    batch_count += 1
                    if batch_count >= 450:
                        batch.commit()
                        batch = db.batch()
                        batch_count = 0
                except Exception as e:
                    print(f'Failed to write activity {act_id}: {e}')

        if batch_count > 0:
            batch.commit()

        total_saved += len(acts)
        page += 1

        # Update progress
        db.document(f'users/{uid}').set({
            'garmin': {
                'backfillProgress': total_saved,
                'backfillStatus': 'syncing',
            }
        }, merge=True)

        # If we got fewer than PAGE_SIZE, we've reached the end
        if len(acts) < PAGE_SIZE:
            found_activities = False

    _save_session(uid)

    has_more = found_activities  # True if we hit the per-call page limit

    if not has_more:
        # All activities loaded — compute weekly stats and mark complete
        try:
            _compute_all_stats(uid)
        except Exception as e:
            print(f'Stats computation failed after backfill for {uid}: {e}')

        db.document(f'users/{uid}').set({
            'garmin': {
                'backfillStatus': 'complete',
                'backfillProgress': 100,
            }
        }, merge=True)

    return {
        'status': 'ok',
        'totalActivities': total_saved,
        'hasMore': has_more,
        'nextPage': page if has_more else None,
    }


# ══════════════════════════════════════════════════════
# USER DATA DELETION (GDPR)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, timeout_sec=300, secrets=[GARMIN_KEY_SECRET])
def delete_user_data(req: https_fn.CallableRequest) -> dict:
    """GDPR right to deletion — remove all user data."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

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
        'startTimeLocal', direction='DESCENDING'
    ).limit(10)
    for doc_snap in act_q.stream():
        d = doc_snap.to_dict()
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
    # Strip markdown fences (```json ... ``` or ``` ... ```)
    if text.startswith('```'):
        # Find opening fence end
        first_nl = text.index('\n')
        # Find closing fence
        last_fence = text.rfind('```', 3)
        if last_fence > 3:
            text = text[first_nl + 1:last_fence].strip()
        else:
            text = text[first_nl + 1:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f'Failed to parse AI JSON: {e}\nRaw text: {text[:500]}')
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message='AI returned an invalid response. Please try again.',
        )


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
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    context = _build_daily_context(uid)
    client = _get_anthropic_client()

    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=2000,
        system=DAILY_ANALYSIS_PROMPT,
        messages=[{'role': 'user', 'content': json.dumps(context, default=str)}],
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
            'generatedBy': 'claude-sonnet-4-5-20250929',
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
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    context = _build_daily_context(uid)
    client = _get_anthropic_client()

    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=3000,
        system=WEEKLY_PLAN_PROMPT,
        messages=[{'role': 'user', 'content': json.dumps(context, default=str)}],
    )

    result = _parse_ai_json(response.content[0].text)

    # Store training plan — plan for the CURRENT week (Monday to Sunday)
    today = date.today()
    days_since_monday = today.weekday()  # 0=Mon, 6=Sun
    week_start = today - timedelta(days=days_since_monday)
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
        'generatedBy': 'claude-sonnet-4-5-20250929',
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
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    question = req.data.get('question', '')
    if not question:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='Question is required',
        )
    if len(question) > 2000:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='Question must be 2000 characters or fewer',
        )

    context = _build_daily_context(uid)
    client = _get_anthropic_client()

    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=1500,
        system="""You are a personal health and fitness assistant. You have access to the user's
Garmin wearable data and health logs. Answer their question using this data.
Be concise, specific, and actionable. Never diagnose medical conditions.
If asked about concerning symptoms, recommend consulting a doctor.""",
        messages=[
            {'role': 'user', 'content': f'My health data:\n{json.dumps(context, default=str)}\n\nQuestion: {question}'},
        ],
    )

    return {
        'status': 'ok',
        'answer': response.content[0].text,
    }


# ══════════════════════════════════════════════════════
# COMPUTE ACTIVITY STATS (Nightly)
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
            _compute_all_stats(uid)
        except Exception as e:
            print(f'Stats computation failed for {uid}: {e}')


@https_fn.on_call(region=REGION, timeout_sec=120)
def compute_stats_on_demand(req: https_fn.CallableRequest) -> dict:
    """Trigger activity stats computation for the calling user."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid
    _compute_all_stats(uid)
    return {'status': 'ok'}


def _compute_all_stats(uid: str):
    """Compute weekly (52 wks), monthly (24 mo), and yearly activity stats."""
    today = date.today()

    # Load ALL activities with pagination
    all_activities = []
    last_doc = None
    while True:
        q = db.collection(f'users/{uid}/activities').order_by(
            'startTimeLocal', direction='DESCENDING'
        ).limit(1000)
        if last_doc:
            q = q.start_after(last_doc)
        docs = list(q.stream())
        if not docs:
            break
        for doc_snap in docs:
            all_activities.append(doc_snap.to_dict())
        last_doc = docs[-1]
        if len(docs) < 1000:
            break

    print(f'Computing all stats for {uid}: {len(all_activities)} activities loaded')

    def _aggregate(activities):
        total_duration = sum(a.get('duration', a.get('movingDuration', 0)) or 0 for a in activities)
        total_distance = sum(a.get('distance', 0) or 0 for a in activities)
        total_calories = sum(a.get('calories', a.get('activeKilocalories', 0)) or 0 for a in activities)
        by_type = {}
        for act in activities:
            t = act.get('activityType', {}).get('typeKey', 'other') if isinstance(act.get('activityType'), dict) else 'other'
            if t not in by_type:
                by_type[t] = {'count': 0, 'duration': 0, 'distance': 0, 'calories': 0}
            by_type[t]['count'] += 1
            by_type[t]['duration'] += (act.get('duration', act.get('movingDuration', 0)) or 0)
            by_type[t]['distance'] += (act.get('distance', 0) or 0)
            by_type[t]['calories'] += (act.get('calories', act.get('activeKilocalories', 0)) or 0)
        return {
            'activityCount': len(activities),
            'totalDurationSeconds': total_duration,
            'totalDistanceMeters': total_distance,
            'totalCalories': total_calories,
            'byType': by_type,
        }

    def _filter(start_date, end_date):
        s, e = start_date.isoformat(), end_date.isoformat()
        return [a for a in all_activities if s <= (a.get('startTimeLocal') or '')[:10] <= e]

    batch = db.batch()
    batch_count = 0

    def _flush():
        nonlocal batch, batch_count
        if batch_count > 0:
            batch.commit()
            batch = db.batch()
            batch_count = 0

    def _write_stat(doc_id, data):
        nonlocal batch, batch_count
        ref = db.document(f'users/{uid}/activityStats/{doc_id}')
        batch.set(ref, {**data, 'computedAt': firestore.SERVER_TIMESTAMP}, merge=True)
        batch_count += 1
        if batch_count >= 450:
            _flush()

    # ── Weekly: last 52 weeks ──
    days_since_monday = today.weekday()
    current_week_start = today - timedelta(days=days_since_monday)
    for w in range(52):
        ws = current_week_start - timedelta(weeks=w)
        we = ws + timedelta(days=6)
        acts = _filter(ws, we)
        _write_stat(f'week_{ws.isoformat()}', {
            'periodType': 'week', 'periodStart': ws.isoformat(), 'periodEnd': we.isoformat(),
            **_aggregate(acts),
        })

    # ── Monthly: last 24 months ──
    for m in range(24):
        mo = today.month - m
        yr = today.year
        while mo <= 0:
            mo += 12
            yr -= 1
        ms = date(yr, mo, 1)
        me = date(yr + 1, 1, 1) - timedelta(days=1) if mo == 12 else date(yr, mo + 1, 1) - timedelta(days=1)
        acts = _filter(ms, me)
        _write_stat(f'month_{ms.isoformat()}', {
            'periodType': 'month', 'periodStart': ms.isoformat(), 'periodEnd': me.isoformat(),
            **_aggregate(acts),
        })

    # ── Yearly: all years with data + current year ──
    years = {today.year}
    for act in all_activities:
        yr_str = (act.get('startTimeLocal') or '')[:4]
        if yr_str and yr_str.isdigit():
            years.add(int(yr_str))
    for y in sorted(years):
        ys = date(y, 1, 1)
        ye = date(y, 12, 31)
        acts = _filter(ys, ye)
        _write_stat(f'year_{y}', {
            'periodType': 'year', 'periodStart': ys.isoformat(), 'periodEnd': ye.isoformat(),
            **_aggregate(acts),
        })

    _flush()
    print(f'Stats computed for {uid}: 52 weeks, 24 months, {len(years)} years')


# ══════════════════════════════════════════════════════
# DATA EXPORT (GDPR)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, timeout_sec=300)
def data_export(req: https_fn.CallableRequest) -> dict:
    """Export all user data as JSON (GDPR right to access)."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    export = {'exportedAt': datetime.utcnow().isoformat(), 'userId': uid}

    # User settings (excluding encrypted fields)
    user_doc = db.document(f'users/{uid}').get()
    if user_doc.exists:
        settings = user_doc.to_dict()
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
            for k, v in d.items():
                if hasattr(v, 'isoformat'):
                    d[k] = v.isoformat()
            docs.append(d)
        export[sub] = docs

    return {'status': 'ok', 'data': export}
