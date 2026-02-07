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
    settings = db.document(f'users/{uid}/settings').get().to_dict()
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
    db.document(f'users/{uid}/settings').update({
        'garmin.garthSession': encrypt(garth.client.dumps()),
        'garmin.lastSyncAt': firestore.SERVER_TIMESTAMP,
    })


def _safe_call(fn, *args, default=None):
    """Call a Garmin API method, returning default on error."""
    try:
        return fn(*args)
    except Exception:
        return default


# ══════════════════════════════════════════════════════
# GARMIN LOGIN
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, memory=options.MemoryOption.MB_256)
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

        # Persist encrypted session
        db.document(f'users/{uid}/settings').update({
            'garmin.connected': True,
            'garmin.garthSession': encrypt(garth.client.dumps()),
            'garmin.garminEmail': encrypt(email),
            'garmin.connectedAt': firestore.SERVER_TIMESTAMP,
            'garmin.lastSyncAt': None,
            'garmin.backfillStatus': 'syncing',
            'garmin.backfillProgress': 0,
            'garmin.displayName': display_name,
        })

        # Kick off initial sync (first 30 days + today)
        _do_sync(uid, client, backfill_days=30)
        _save_session(uid)

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

@https_fn.on_call(region=REGION)
def garmin_disconnect(req: https_fn.CallableRequest) -> dict:
    """Disconnect Garmin — remove tokens but keep historical data."""
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )

    db.document(f'users/{uid}/settings').update({
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

@https_fn.on_call(region=REGION, memory=options.MemoryOption.MB_256)
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
)
def garmin_scheduled_sync(event: scheduler_fn.ScheduledEvent) -> None:
    """Sync all connected Garmin users every 15 minutes."""
    # Query all users with garmin.connected == true
    users_ref = db.collection_group('settings').where(
        filter=google.cloud.firestore.FieldFilter('garmin.connected', '==', True)
    )

    for settings_doc in users_ref.stream():
        uid = settings_doc.reference.parent.parent.id
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
    db.document(f'users/{uid}/settings').update({
        'garmin.backfillProgress': progress,
    })

    has_more = actual_end < days_back

    if not has_more:
        db.document(f'users/{uid}/settings').update({
            'garmin.backfillStatus': 'complete',
            'garmin.backfillProgress': 100,
        })

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

@https_fn.on_call(region=REGION, timeout_sec=300)
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
    db.document(f'users/{uid}/settings').delete()

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
