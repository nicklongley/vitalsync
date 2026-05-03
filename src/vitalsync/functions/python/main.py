# ══════════════════════════════════════════════════════
# VITALSYNC — Cloud Functions (Python)
# intervals.icu sync (wellness + activities) + Claude AI analysis
# ══════════════════════════════════════════════════════

import json
import os
import base64
import time
from datetime import date, timedelta, datetime

import requests
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
# Reuses the existing GARMIN_ENCRYPTION_KEY secret to avoid manual rotation.
# Now used to encrypt the user's intervals.icu API key at rest.
ENCRYPTION_KEY_SECRET = options.SecretParam('GARMIN_ENCRYPTION_KEY')


# ══════════════════════════════════════════════════════
# ENCRYPTION HELPERS
# ══════════════════════════════════════════════════════

def _get_encryption_key() -> bytes:
    key_hex = os.environ.get('GARMIN_ENCRYPTION_KEY', '')
    if not key_hex:
        raise ValueError('GARMIN_ENCRYPTION_KEY not set — configure via Secret Manager')
    return bytes.fromhex(key_hex)


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(12)
    aesgcm = AESGCM(_get_encryption_key())
    ct = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)
    return base64.b64encode(nonce + ct).decode('utf-8')


def decrypt(ciphertext: str) -> str:
    raw = base64.b64decode(ciphertext)
    nonce, ct = raw[:12], raw[12:]
    aesgcm = AESGCM(_get_encryption_key())
    return aesgcm.decrypt(nonce, ct, None).decode('utf-8')


# ══════════════════════════════════════════════════════
# INTERVALS.ICU CLIENT
# ══════════════════════════════════════════════════════

INTERVALS_BASE_URL = "https://intervals.icu/api/v1"


class IntervalsAuthError(Exception):
    pass


def _intervals_request(api_key: str, path: str, params: dict = None, default=None):
    """GET request to intervals.icu with HTTP Basic auth (username 'API_KEY')."""
    url = f"{INTERVALS_BASE_URL}{path}"
    try:
        resp = requests.get(
            url,
            auth=('API_KEY', api_key),
            params=params or {},
            timeout=30,
            headers={'Accept': 'application/json'},
        )
        if resp.status_code == 401:
            raise IntervalsAuthError('Invalid API key')
        if resp.status_code == 429:
            print(f'intervals.icu rate-limited for {path} — backing off')
            time.sleep(2)
            return default
        if resp.status_code == 204 or not resp.content:
            return default
        resp.raise_for_status()
        return resp.json()
    except IntervalsAuthError:
        raise
    except Exception as e:
        print(f'intervals.icu request failed for {path}: {e}')
        return default


def _get_user_api_key(uid: str) -> str:
    user = db.document(f'users/{uid}').get().to_dict() or {}
    cfg = user.get('intervals', {})
    if not cfg.get('connected'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='intervals.icu not connected',
        )
    if cfg.get('needs_reauth'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='intervals.icu API key invalid — please re-enter in Settings',
        )
    enc = cfg.get('encrypted_api_key')
    if not enc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='No API key stored',
        )
    return decrypt(enc)


# ══════════════════════════════════════════════════════
# FIRESTORE SANITISATION
# ══════════════════════════════════════════════════════

def _sanitize_for_firestore(data, max_depth=10):
    """Strip oversized arrays, fix unsupported types, cap nesting."""
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
# ACTIVITY TYPE MAPPING (intervals.icu → Garmin typeKey)
# Keeps the existing UI sport-icon and stats grouping working.
# ══════════════════════════════════════════════════════

_TYPE_MAP = {
    'Ride': 'cycling',
    'VirtualRide': 'indoor_cycling',
    'EBikeRide': 'cycling',
    'GravelRide': 'gravel_cycling',
    'MountainBikeRide': 'mountain_biking',
    'Run': 'running',
    'TrailRun': 'trail_running',
    'TreadmillRun': 'treadmill_running',
    'VirtualRun': 'treadmill_running',
    'Swim': 'swimming',
    'OpenWaterSwim': 'open_water_swimming',
    'Walk': 'walking',
    'Hike': 'hiking',
    'WeightTraining': 'strength_training',
    'Workout': 'strength_training',
    'Yoga': 'yoga',
    'Rowing': 'rowing',
    'Kayaking': 'rowing',
    'Elliptical': 'elliptical',
    'StairStepper': 'stair_climbing',
}


def _first(*vals):
    """Return the first non-None, non-zero value (or None)."""
    for v in vals:
        if v is not None and v != 0 and v != '':
            return v
    return None


def _map_intervals_activity(act: dict) -> dict:
    """intervals.icu activity → Garmin-compatible schema for frontend.
    Tries multiple field-name variants because the list and detail endpoints don't
    always return the same keys (e.g. average_watts vs icu_average_watts vs avgPower).
    """
    act_id = act.get('id')
    raw_type = act.get('type', '') or ''
    type_key = _TYPE_MAP.get(raw_type, raw_type.lower() or 'other')
    if act.get('calories'):
        calories = int(act['calories'])
    elif act.get('kilojoules'):
        calories = int(act['kilojoules'] / 4.184)
    elif act.get('icu_joules'):
        calories = int(act['icu_joules'] / 4184)
    else:
        calories = None
    return {
        'activityId': f'intervals_{act_id}',
        'intervalsId': act_id,
        'activityName': act.get('name'),
        'description': act.get('description'),
        'startTimeLocal': act.get('start_date_local'),
        'startTimeGMT': act.get('start_date'),
        'duration': _first(act.get('elapsed_time'), act.get('icu_duration')),
        'movingDuration': _first(act.get('moving_time'), act.get('icu_moving_time')),
        'distance': act.get('distance'),
        'elevationGain': _first(act.get('total_elevation_gain'), act.get('elevationGain')),
        'elevationLoss': act.get('total_elevation_loss'),
        'calories': calories,
        'averageHR': _first(act.get('average_heartrate'), act.get('avgHr'), act.get('icu_average_heartrate')),
        'maxHR': _first(act.get('max_heartrate'), act.get('maxHr')),
        'averagePower': _first(act.get('average_watts'), act.get('icu_average_watts'), act.get('avgPower')),
        'normalizedPower': _first(act.get('icu_weighted_avg_watts'), act.get('weighted_average_watts')),
        'maxPower': _first(act.get('max_watts'), act.get('maxPower')),
        'averageSpeed': act.get('average_speed'),
        'maxSpeed': act.get('max_speed'),
        'averageCadence': _first(act.get('average_cadence'), act.get('avg_cadence')),
        'trainingLoad': _first(act.get('icu_training_load'), act.get('trainingLoad')),
        'intensityFactor': _first(act.get('icu_intensity'), act.get('intensityFactor')),
        'tss': _first(act.get('icu_training_load'), act.get('trainingLoad')),
        'ftpAtTime': act.get('icu_ftp'),
        'activityType': {'typeKey': type_key},
        'rawType': raw_type,
        'deviceName': act.get('device_name'),
        'sourceClient': act.get('oauth_client_name'),
        'sourceType': act.get('source'),
        'externalId': act.get('external_id'),
        'fileType': act.get('file_type'),
        'source': 'intervals',
    }


# ══════════════════════════════════════════════════════
# SYNC CORE
# ══════════════════════════════════════════════════════

def _refresh_athlete_profile(uid: str, api_key: str) -> dict:
    """Pull FTP / threshold HR / max HR / threshold pace from intervals.icu and persist
    them onto users/{uid}.profile so the rest of the app (Dashboard, AI Context, plan
    generation) can read them. Returns the update dict applied (empty if nothing).
    """
    try:
        result = _intervals_request(api_key, '/athlete/0/profile', default={}) or {}
    except IntervalsAuthError:
        raise
    except Exception as e:
        print(f'Failed to fetch intervals athlete profile: {e}')
        return {}

    # Response shape varies — try both flat and nested {athlete: {...}} forms
    athlete = result.get('athlete') if isinstance(result.get('athlete'), dict) else result
    if not isinstance(athlete, dict):
        return {}

    update = {}

    def _pick(*keys):
        for k in keys:
            v = athlete.get(k)
            if v is not None and v != 0 and v != '':
                return v
        return None

    ftp = _pick('icu_ftp', 'ftp', 'ftpw')
    if ftp and ftp > 0:
        update['ftp'] = int(ftp)
        update['ftpSource'] = 'intervals'

    lthr = _pick('lthr', 'icu_lthr', 'thresholdHr', 'threshold_hr')
    if lthr and lthr > 0:
        update['thresholdHR'] = int(lthr)

    max_hr = _pick('max_heartrate', 'icu_max_heartrate', 'maxHr')
    if max_hr and max_hr > 0:
        update['maxHR'] = int(max_hr)

    resting_hr = _pick('icu_resting_hr', 'restingHr')
    if resting_hr and resting_hr > 0:
        update['restingHR'] = int(resting_hr)

    threshold_pace = _pick('threshold_pace', 'icu_threshold_pace')
    if threshold_pace and threshold_pace > 0:
        update['thresholdPace'] = threshold_pace

    weight = _pick('weight', 'icu_weight')
    if weight and weight > 0 and not update.get('weight'):
        # Only set weight if intervals.icu has it AND the existing weight came from intervals/empty
        # (don't clobber a recent manual entry)
        user_doc = db.document(f'users/{uid}').get().to_dict() or {}
        existing = (user_doc.get('profile') or {}).get('weight')
        existing_source = (user_doc.get('profile') or {}).get('weightSource')
        if not existing or existing_source == 'intervals':
            update['weight'] = round(float(weight), 1)
            update['weightSource'] = 'intervals'

    if update:
        try:
            db.document(f'users/{uid}').set({'profile': update}, merge=True)
            print(f'Refreshed profile from intervals.icu: {update}')
        except Exception as e:
            print(f'Profile update write failed: {e}')

    return update


def _resume_start_date(uid: str) -> str:
    """Resume from latest garmin/intervals sync timestamp (with 1d overlap), else 30d ago."""
    user = db.document(f'users/{uid}').get().to_dict() or {}
    candidates = []
    for cfg_key in ('intervals', 'garmin'):
        cfg = user.get(cfg_key, {}) or {}
        ts = cfg.get('last_sync_at')
        if ts is not None and hasattr(ts, 'date'):
            try:
                candidates.append(ts.date())
            except Exception:
                pass
    if candidates:
        return (max(candidates) - timedelta(days=1)).isoformat()
    return (date.today() - timedelta(days=30)).isoformat()


def _do_intervals_sync(uid: str, api_key: str, start_date: str, end_date: str = None):
    """Pull wellness + activities for a date range and upsert to Firestore."""
    if not end_date:
        end_date = date.today().isoformat()

    print(f'intervals sync {uid}: {start_date} → {end_date}')

    # ── Wellness ──
    wellness = _intervals_request(
        api_key,
        '/athlete/0/wellness',
        params={'oldest': start_date, 'newest': end_date},
        default=[],
    ) or []

    latest_weight = None
    latest_body_fat = None
    latest_weight_date = ''

    batch = db.batch()
    write_count = 0
    for entry in wellness:
        date_id = entry.get('id') or entry.get('date')
        if not date_id:
            continue
        # Track latest weight reading for profile update
        w = entry.get('weight')
        if w and isinstance(w, (int, float)) and w > 0 and date_id > latest_weight_date:
            latest_weight = w
            latest_body_fat = entry.get('bodyFat')
            latest_weight_date = date_id

        ref = db.document(f'users/{uid}/wellnessDaily/{date_id}')
        clean = _sanitize_for_firestore(entry)
        clean['source'] = 'intervals'
        clean['processedAt'] = firestore.SERVER_TIMESTAMP
        batch.set(ref, clean, merge=True)
        write_count += 1
        if write_count >= 450:
            batch.commit()
            batch = db.batch()
            write_count = 0
    if write_count > 0:
        batch.commit()

    if latest_weight:
        weight_update = {'weight': round(latest_weight, 1), 'weightSource': 'intervals'}
        if latest_body_fat and isinstance(latest_body_fat, (int, float)) and 0 < latest_body_fat < 100:
            weight_update['bodyFatPct'] = round(latest_body_fat, 1)
        try:
            db.document(f'users/{uid}').set({'profile': weight_update}, merge=True)
            print(f'Updated profile weight from intervals.icu: {weight_update["weight"]} kg')
        except Exception as e:
            print(f'Profile weight update failed: {e}')

    # ── Activities ──
    activities = _intervals_request(
        api_key,
        '/athlete/0/activities',
        params={'oldest': start_date, 'newest': end_date},
        default=[],
    ) or []

    batch = db.batch()
    write_count = 0
    for act in activities:
        act_id = act.get('id')
        if not act_id:
            continue
        try:
            mapped = _map_intervals_activity(act)
            ref = db.document(f'users/{uid}/activities/intervals_{act_id}')
            clean = _sanitize_for_firestore(mapped)
            clean['processedAt'] = firestore.SERVER_TIMESTAMP
            batch.set(ref, clean, merge=True)
            write_count += 1
            if write_count >= 450:
                batch.commit()
                batch = db.batch()
                write_count = 0
        except Exception as e:
            print(f'Failed to write activity intervals_{act_id}: {e}')

    if write_count > 0:
        batch.commit()

    # Mark plan sessions complete when activities pair with our pushed events
    try:
        _sync_plan_completion(uid, activities)
    except Exception as e:
        print(f'Plan completion sync failed for {uid}: {e}')

    # Refresh FTP / threshold HR / weight from intervals.icu athlete profile
    try:
        _refresh_athlete_profile(uid, api_key)
    except IntervalsAuthError:
        raise
    except Exception as e:
        print(f'Athlete profile refresh failed for {uid}: {e}')

    print(f'intervals sync done {uid}: {len(wellness)} wellness, {len(activities)} activities')
    return {'wellness': len(wellness), 'activities': len(activities)}


# ══════════════════════════════════════════════════════
# CONNECT — store API key, validate, initial backfill
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.GB_1,
    timeout_sec=540,
    secrets=[ENCRYPTION_KEY_SECRET],
)
def intervals_set_api_key(req: https_fn.CallableRequest) -> dict:
    """Validate API key against intervals.icu and store encrypted; run initial sync."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    api_key = (req.data.get('api_key') or '').strip()
    if not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='API key is required',
        )

    try:
        profile = _intervals_request(api_key, '/athlete/0/profile')
    except IntervalsAuthError:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='Invalid API key. Check it on intervals.icu Settings → Developer.',
        )

    if not profile:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message='Could not reach intervals.icu — try again shortly.',
        )

    athlete = profile.get('athlete') or profile
    display_name = athlete.get('name') or athlete.get('displayName') or athlete.get('firstname') or ''

    db.document(f'users/{uid}').set({
        'intervals': {
            'connected': True,
            'encrypted_api_key': encrypt(api_key),
            'displayName': display_name,
            'connectedAt': firestore.SERVER_TIMESTAMP,
            'last_sync_at': None,
            'needs_reauth': False,
            'backfillStatus': 'syncing',
            'backfillProgress': 0,
        },
    }, merge=True)

    try:
        start_date = _resume_start_date(uid)
        _do_intervals_sync(uid, api_key, start_date=start_date)
        db.document(f'users/{uid}').set({
            'intervals': {
                'backfillStatus': 'complete',
                'backfillProgress': 100,
                'last_sync_at': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)
    except IntervalsAuthError:
        db.document(f'users/{uid}').set({
            'intervals': {'needs_reauth': True, 'backfillStatus': 'idle'},
        }, merge=True)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='API key rejected during sync.',
        )
    except Exception as e:
        print(f'Initial intervals sync failed for {uid}: {e}')
        db.document(f'users/{uid}').set({
            'intervals': {'backfillStatus': 'idle'},
        }, merge=True)

    return {'status': 'connected', 'displayName': display_name}


# ══════════════════════════════════════════════════════
# DISCONNECT
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION)
def intervals_disconnect(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    db.document(f'users/{uid}').update({
        'intervals.connected': False,
        'intervals.encrypted_api_key': firestore.DELETE_FIELD,
        'intervals.needs_reauth': firestore.DELETE_FIELD,
        'intervals.disconnectedAt': firestore.SERVER_TIMESTAMP,
    })
    return {'status': 'disconnected'}


# ══════════════════════════════════════════════════════
# SYNC — ON-DEMAND (user opens app)
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=300,
    secrets=[ENCRYPTION_KEY_SECRET],
)
def intervals_sync_on_demand(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    api_key = _get_user_api_key(uid)
    start = (date.today() - timedelta(days=2)).isoformat()
    try:
        result = _do_intervals_sync(uid, api_key, start_date=start)
    except IntervalsAuthError:
        db.document(f'users/{uid}').set({
            'intervals': {'needs_reauth': True},
        }, merge=True)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='API key rejected — please re-enter in Settings.',
        )

    db.document(f'users/{uid}').set({
        'intervals': {'last_sync_at': firestore.SERVER_TIMESTAMP},
    }, merge=True)
    return {'status': 'ok', 'syncedAt': datetime.utcnow().isoformat(), **result}


# ══════════════════════════════════════════════════════
# SYNC — SCHEDULED (every 30 minutes)
# ══════════════════════════════════════════════════════

@scheduler_fn.on_schedule(
    schedule='every 30 minutes',
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=540,
    secrets=[ENCRYPTION_KEY_SECRET],
)
def intervals_scheduled_sync(event: scheduler_fn.ScheduledEvent) -> None:
    """Sync every connected intervals.icu user."""
    users_ref = db.collection('users').where(
        filter=google.cloud.firestore.FieldFilter('intervals.connected', '==', True)
    )
    start = (date.today() - timedelta(days=2)).isoformat()

    for user_doc in users_ref.stream():
        uid = user_doc.id
        try:
            api_key = _get_user_api_key(uid)
            _do_intervals_sync(uid, api_key, start_date=start)
            db.document(f'users/{uid}').set({
                'intervals': {'last_sync_at': firestore.SERVER_TIMESTAMP},
            }, merge=True)
        except IntervalsAuthError:
            db.document(f'users/{uid}').set({
                'intervals': {'needs_reauth': True},
            }, merge=True)
        except Exception as e:
            print(f'Scheduled sync failed for {uid}: {e}')


# ══════════════════════════════════════════════════════
# BACKFILL — extend history N days back
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.GB_1,
    timeout_sec=540,
    secrets=[ENCRYPTION_KEY_SECRET],
)
def intervals_backfill(req: https_fn.CallableRequest) -> dict:
    """Pull `days` of history (default 365). Chunked to fit timeouts."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    try:
        days = int(req.data.get('days', 365))
    except (ValueError, TypeError):
        days = 365
    days = max(1, min(days, 3650))

    api_key = _get_user_api_key(uid)

    db.document(f'users/{uid}').set({
        'intervals': {'backfillStatus': 'syncing', 'backfillProgress': 0},
    }, merge=True)

    today = date.today()
    chunk_days = 60
    total_w = 0
    total_a = 0
    chunks_total = (days + chunk_days - 1) // chunk_days
    chunk_end = today
    chunks_done = 0

    while chunk_end > today - timedelta(days=days):
        chunk_start = max(
            chunk_end - timedelta(days=chunk_days - 1),
            today - timedelta(days=days),
        )
        try:
            result = _do_intervals_sync(
                uid, api_key,
                start_date=chunk_start.isoformat(),
                end_date=chunk_end.isoformat(),
            )
            total_w += result.get('wellness', 0)
            total_a += result.get('activities', 0)
        except IntervalsAuthError:
            db.document(f'users/{uid}').set({
                'intervals': {'needs_reauth': True, 'backfillStatus': 'idle'},
            }, merge=True)
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                message='API key rejected during backfill.',
            )
        except Exception as e:
            print(f'Backfill chunk failed for {uid} ({chunk_start}→{chunk_end}): {e}')

        chunks_done += 1
        progress = min(100, int(chunks_done / chunks_total * 100))
        db.document(f'users/{uid}').set({
            'intervals': {'backfillProgress': progress},
        }, merge=True)
        chunk_end = chunk_start - timedelta(days=1)

    try:
        _compute_all_stats(uid)
    except Exception as e:
        print(f'Stats computation after backfill failed for {uid}: {e}')

    db.document(f'users/{uid}').set({
        'intervals': {
            'backfillStatus': 'complete',
            'backfillProgress': 100,
            'last_sync_at': firestore.SERVER_TIMESTAMP,
        },
    }, merge=True)

    return {
        'status': 'ok',
        'totalWellness': total_w,
        'totalActivities': total_a,
    }


# ══════════════════════════════════════════════════════
# ACTIVITY STREAMS (lazy fetch from intervals.icu)
# ══════════════════════════════════════════════════════

_DEFAULT_STREAM_TYPES = 'time,watts,heartrate,cadence,altitude,distance,velocity_smooth'


@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=60,
    secrets=[ENCRYPTION_KEY_SECRET],
)
def intervals_get_activity_streams(req: https_fn.CallableRequest) -> dict:
    """Fetch fresh activity detail + streams from intervals.icu on demand.

    Returns the full activity object (richer than what we persist in Firestore — the
    list-endpoint summary may lack some power/HR fields) plus a streams dict keyed
    by type name (parallel arrays).
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    intervals_id = req.data.get('intervalsId')
    if not intervals_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='intervalsId is required',
        )
    types = req.data.get('types') or _DEFAULT_STREAM_TYPES

    api_key = _get_user_api_key(uid)
    try:
        detail = _intervals_request(
            api_key,
            f'/activity/{intervals_id}',
            default={},
        ) or {}
        result = _intervals_request(
            api_key,
            f'/activity/{intervals_id}/streams',
            params={'types': types},
            default=[],
        )
    except IntervalsAuthError:
        db.document(f'users/{uid}').set({
            'intervals': {'needs_reauth': True},
        }, merge=True)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='intervals.icu rejected the API key.',
        )

    # intervals.icu returns streams as a list of {type, name, valueType, data: [...]}.
    # Flatten to a dict keyed by type name for easier consumption client-side.
    streams = {}
    if isinstance(result, list):
        for stream in result:
            if isinstance(stream, dict):
                t = stream.get('type')
                data = stream.get('data')
                if t and isinstance(data, list):
                    streams[t] = data[:5000] if len(data) > 5000 else data

    # Sanitize detail to drop heavy nested arrays (laps, etc. — UI doesn't need them).
    detail_clean = _sanitize_for_firestore(detail) if detail else {}

    return {'status': 'ok', 'detail': detail_clean, 'streams': streams}


# ══════════════════════════════════════════════════════
# TRAINING PLAN → INTERVALS.ICU PUSH
# ══════════════════════════════════════════════════════

# Slot defaults — morning is 05:30 per user request
_SLOT_TIMES = {
    'morning': '05:30',
    'afternoon': '12:00',
    'evening': '18:00',
}

_DAY_OFFSET = {
    'monday': 0, 'mon': 0,
    'tuesday': 1, 'tue': 1,
    'wednesday': 2, 'wed': 2,
    'thursday': 3, 'thu': 3,
    'friday': 4, 'fri': 4,
    'saturday': 5, 'sat': 5,
    'sunday': 6, 'sun': 6,
}

_SESSION_TYPE_TO_INTERVALS = {
    'run': 'Run',
    'running': 'Run',
    'cycle': 'Ride',
    'cycling': 'Ride',
    'bike': 'Ride',
    'ride': 'Ride',
    'swim': 'Swim',
    'swimming': 'Swim',
    'strength': 'WeightTraining',
    'gym': 'WeightTraining',
    'yoga': 'Yoga',
    'active_recovery': 'Workout',
    'walk': 'Walk',
    'walking': 'Walk',
    'hike': 'Hike',
    'hiking': 'Hike',
    'rowing': 'Rowing',
    'kayak': 'Kayaking',
}


def _session_datetime(week_start: str, day: str, slot: str) -> str:
    """Return start_date_local for an intervals.icu WORKOUT event.
    intervals.icu requires WORKOUT events to use T00:00:00 (date-only, all-day);
    a real time component causes the event to land on the wrong day or get
    rejected. Slot is recorded on our own plan doc but not on the intervals event.
    """
    week_start_date = date.fromisoformat(week_start)
    offset = _DAY_OFFSET.get((day or '').lower(), 0)
    session_date = week_start_date + timedelta(days=offset)
    return f'{session_date.isoformat()}T00:00:00'


def _build_event_payload(plan_id: str, session: dict, week_start: str) -> dict | None:
    """Map a plan session → intervals.icu event payload. Returns None to skip (rest)."""
    sess_type = (session.get('type') or '').lower()
    if sess_type in ('rest', ''):
        return None
    intervals_type = _SESSION_TYPE_TO_INTERVALS.get(sess_type, 'Workout')

    day = session.get('day') or 'monday'
    slot = session.get('slot') or 'morning'
    start = _session_datetime(week_start, day, slot)

    duration_min = session.get('durationMinutes') or 0
    moving_time = int(duration_min * 60) if duration_min else None

    # intervals.icu parses the description as workout-builder syntax to build
    # structured intervals. Free-text mixed in confuses the parser, so prefer
    # the structured workoutScript when available; only fall back to plain
    # text if no script (e.g. strength/yoga sessions).
    workout_script = (session.get('workoutScript') or '').strip()
    if workout_script:
        description = workout_script
    else:
        parts = []
        if session.get('description'):
            parts.append(session['description'])
        if session.get('warmUp'):
            parts.append(f"Warm-up: {session['warmUp']}")
        if session.get('mainSet'):
            parts.append(f"Main: {session['mainSet']}")
        if session.get('coolDown'):
            parts.append(f"Cool-down: {session['coolDown']}")
        description = '\n\n'.join(parts)

    payload = {
        'category': 'WORKOUT',
        'type': intervals_type,
        'start_date_local': start,
        'name': session.get('title') or 'Training session',
        'description': description,
        'external_id': f'vitalsync-{plan_id}-{day.lower()}-{slot.lower()}',
    }
    if moving_time:
        payload['moving_time'] = moving_time
    return payload


def _intervals_post(api_key: str, path: str, json_body: dict):
    """POST helper for intervals.icu (returns parsed JSON or raises IntervalsAuthError)."""
    url = f"{INTERVALS_BASE_URL}{path}"
    resp = requests.post(
        url,
        auth=('API_KEY', api_key),
        json=json_body,
        timeout=30,
        headers={'Accept': 'application/json'},
    )
    if resp.status_code == 401:
        raise IntervalsAuthError('Invalid API key')
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def _intervals_delete(api_key: str, path: str):
    """DELETE helper for intervals.icu (swallows 404 — already gone)."""
    url = f"{INTERVALS_BASE_URL}{path}"
    resp = requests.delete(
        url,
        auth=('API_KEY', api_key),
        timeout=30,
        headers={'Accept': 'application/json'},
    )
    if resp.status_code == 401:
        raise IntervalsAuthError('Invalid API key')
    if resp.status_code in (404, 410):
        return None
    resp.raise_for_status()
    return None


def _delete_intervals_events(api_key: str, event_ids: list):
    for eid in event_ids:
        if not eid:
            continue
        try:
            _intervals_delete(api_key, f'/athlete/0/events/{eid}')
        except IntervalsAuthError:
            raise
        except Exception as e:
            print(f'Failed to delete intervals event {eid}: {e}')


@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=300,
    secrets=[ENCRYPTION_KEY_SECRET],
)
def intervals_push_plan(req: https_fn.CallableRequest) -> dict:
    """Push a training plan's sessions to intervals.icu as scheduled events.
    Idempotent: deletes any previously pushed events for this plan first.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    plan_id = req.data.get('planId')
    if not plan_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='planId is required',
        )

    plan_ref = db.document(f'users/{uid}/trainingPlans/{plan_id}')
    plan_snap = plan_ref.get()
    if not plan_snap.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Plan not found',
        )

    plan = plan_snap.to_dict()
    week_start = plan.get('weekStartDate')
    sessions = plan.get('sessions') or []
    if not week_start or not sessions:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='Plan is missing weekStartDate or sessions',
        )

    api_key = _get_user_api_key(uid)

    # Delete any previously pushed events for this plan (idempotent re-push).
    prior_event_ids = plan.get('intervalsEventIds') or []
    if prior_event_ids:
        try:
            _delete_intervals_events(api_key, prior_event_ids)
        except IntervalsAuthError:
            db.document(f'users/{uid}').set({
                'intervals': {'needs_reauth': True},
            }, merge=True)
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                message='intervals.icu rejected the API key.',
            )

    # Push new events; preserve session-index alignment so completion sync can match.
    event_ids = []
    pushed = 0
    skipped = 0
    failures = []
    for idx, session in enumerate(sessions):
        payload = _build_event_payload(plan_id, session, week_start)
        if payload is None:
            event_ids.append(None)
            skipped += 1
            continue
        try:
            result = _intervals_post(api_key, '/athlete/0/events', payload)
            eid = result.get('id') if isinstance(result, dict) else None
            event_ids.append(eid)
            if eid:
                pushed += 1
            else:
                failures.append(f'session {idx}: no id returned')
        except IntervalsAuthError:
            db.document(f'users/{uid}').set({
                'intervals': {'needs_reauth': True},
            }, merge=True)
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                message='intervals.icu rejected the API key.',
            )
        except Exception as e:
            print(f'Failed to push session {idx}: {e}')
            event_ids.append(None)
            failures.append(f'session {idx}: {e}')

    plan_ref.set({
        'intervalsEventIds': event_ids,
        'pushedToIntervalsAt': firestore.SERVER_TIMESTAMP,
    }, merge=True)

    return {
        'status': 'ok',
        'pushed': pushed,
        'skipped': skipped,
        'failed': len(failures),
        'failures': failures[:5],
    }


def _sync_plan_completion(uid: str, activities: list):
    """Mark plan sessions completed when an intervals.icu activity links to a pushed event.
    Activities must be raw intervals.icu objects (with paired_event_id field).
    """
    if not activities:
        return
    paired_event_ids = {a.get('paired_event_id') for a in activities if a.get('paired_event_id')}
    if not paired_event_ids:
        return

    # Active plans only — recent ones might still have un-completed sessions.
    plans_q = (
        db.collection(f'users/{uid}/trainingPlans')
        .order_by('createdAt', direction='DESCENDING')
        .limit(4)
    )
    for plan_snap in plans_q.stream():
        plan = plan_snap.to_dict()
        event_ids = plan.get('intervalsEventIds') or []
        if not event_ids:
            continue
        sessions = plan.get('sessions') or []
        changed = False
        for idx, eid in enumerate(event_ids):
            if eid and eid in paired_event_ids and idx < len(sessions):
                if not sessions[idx].get('completed'):
                    sessions[idx]['completed'] = True
                    sessions[idx]['completedSource'] = 'intervals'
                    changed = True
        if changed:
            plan_snap.reference.set({'sessions': sessions}, merge=True)
            print(f'Plan {plan_snap.id}: marked sessions complete from intervals.icu')


# ══════════════════════════════════════════════════════
# USER DATA DELETION (GDPR)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION, timeout_sec=300)
def delete_user_data(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    subcollections = [
        'activities', 'healthLog', 'interventions', 'trainingPlans',
        'wellnessDaily', 'garminDailies', 'garminSleep', 'activityStats',
        'trends', 'backfillJobs', 'promptState', 'cyclingProfile',
        'lifetimeStats',
    ]
    for sub in subcollections:
        _delete_collection(f'users/{uid}/{sub}')

    db.document(f'users/{uid}').delete()

    try:
        fb_auth.delete_user(uid)
    except Exception as e:
        print(f'Auth deletion failed: {e}')

    db.collection('auditLog').add({
        'action': 'user_deletion',
        'timestamp': firestore.SERVER_TIMESTAMP,
    })
    return {'status': 'deleted'}


def _delete_collection(path: str, batch_size: int = 100):
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

DAILY_ANALYSIS_PROMPT = """You are a personal health and fitness analyst. You receive comprehensive
training and wellness data from intervals.icu (which aggregates a Garmin watch and Hammerhead Karoo)
plus manually logged health metrics. Your role is to:

1. ANALYSE the data for patterns, concerns, and opportunities
2. GENERATE 2-4 prioritised interventions for today
3. ADJUST the current training plan if needed based on recovery metrics

CRITICAL RULES:
- Never diagnose medical conditions. Flag concerning trends for doctor review.
- Blood pressure > 140/90 or < 90/60 → always flag as high priority
- Resting HR change > 10bpm from baseline → flag recovery concern
- HRV declining 3+ days → suggest recovery day
- Sleep score < 60 for 3+ nights → prioritise sleep interventions
- Negative Form (TSB) for many days running → suggest deload
- CTL ramp rate > +5/week → flag overtraining risk

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
training plan. You receive user profile, recent training data, intervals.icu metrics
(CTL/ATL/Form, wellness), and availability constraints.

PRINCIPLES:
- Progressive overload: max 10% volume increase per week
- Respect recovery: use HRV, Form (TSB), and sleep data
- NEVER exceed the user's stated availability for any day
- NEVER schedule on designated rest days
- Total planned hours MUST be ≤ totalHoursPerWeek budget
- Include warm-up and cool-down in every session
- For runners: 80/20 rule (80% easy, 20% hard effort)

For each non-rest session, also output `workoutScript` — a structured workout in
intervals.icu's workout-builder syntax. intervals.icu parses this and pushes a paired
structured workout to the user's Garmin/Hammerhead. The parser is strict — match the
examples below exactly.

CYCLING WORKOUT (type=cycle):
  Warmup
  - 10m 60%
  - 5m ramp 60%-80%

  4x
  - 3m 105%
  - 2m 50%

  Cooldown
  - 10m 50%

RUNNING WORKOUT — HR-based (type=run):
  Warmup
  - 10m 65-70% HR

  4x
  - 3m 88-92% HR
  - 2m 70% HR

  Cooldown
  - 10m 60-65% HR

RUNNING WORKOUT — pace-based (type=run):
  Warmup
  - 10m Z2 HR

  Main
  - 30m 78-82% Pace

  Cooldown
  - 10m Z2 HR

SWIMMING WORKOUT (type=swim):
  Warmup
  - 400mtr Z1 Pace

  8x
  - 100mtr 1:30/100m Pace
  - 30s

  Cooldown
  - 200mtr Z1 Pace

SYNTAX RULES — match exactly:
1. Section headers ("Warmup", "Main", "Cooldown", "Cool down" etc.) on their OWN line
   with NO leading dash and NO target on the same line.
2. Each step line starts with "- " (dash then space) at the very start of the line.
3. Step format: "- <duration> <target> [optional cadence/note]"
4. Duration: "30s", "5m", "1h30m" (combine units, NEVER write "10min" or "10 minutes").
5. Distance (swim/run by distance): "500mtr", "1km", "100m" — for swims with distance.
6. Repeat blocks: "Nx" on its own line, then the steps below (no indentation).
7. TARGET FORMAT — sport-specific. Get this right or the parser fails:
   - Cycling (cycle/ride): bare "%" = %FTP (e.g. "90%", "100-105%"); also "220w", "Z2"
   - Running (run): MUST use "% HR" (max HR), "% LTHR", "Z2 HR", "Z3 HR", "% Pace",
     "Z2 Pace", or absolute pace like "5:00/km Pace". NEVER use bare "%" for runs —
     bare "%" only works for cycling.
   - Swimming (swim): "% Pace", "Z1 Pace", or absolute pace like "1:30/100m Pace".
8. Spacing matters: write "70% HR" with the space, capital H and R. Same for "% LTHR",
   "% Pace", "Z2 HR", "Z2 Pace".
9. Use ranges ("88-92% HR") for outdoor sessions to avoid Garmin alert spam.
10. Total of all step durations MUST equal durationMinutes.
11. For strength, yoga, or active_recovery: set workoutScript to "" (empty string) —
    these don't structure into device intervals.

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "weekSummary": "Overview and focus for this week",
  "focusAreas": ["endurance", "speed", "recovery"],
  "totalPlannedMinutes": 540,
  "sessions": [
    {
      "day": "monday",
      "slot": "morning|afternoon|evening",
      "type": "run|cycle|swim|strength|yoga|rest|active_recovery",
      "title": "Short title",
      "description": "What to do",
      "durationMinutes": 40,
      "intensityLevel": "easy|moderate|hard|max",
      "warmUp": "5 min walk, dynamic stretches",
      "mainSet": "Description of main workout",
      "coolDown": "5 min walk, static stretches",
      "workoutScript": "Warmup\\n- 10m 60%\\n\\n4x\\n- 3m 105%\\n- 2m 50%\\n\\nCooldown\\n- 10m 50%   // for runs use '% HR' not bare '%'"
    }
  ]
}"""


def _get_anthropic_client():
    import anthropic
    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        raise ValueError('ANTHROPIC_API_KEY not set')
    return anthropic.Anthropic(api_key=api_key)


def _get_wellness_for_date(uid: str, date_str: str) -> dict:
    """Read wellness from intervals.icu collection first, fall back to historical Garmin."""
    snap = db.document(f'users/{uid}/wellnessDaily/{date_str}').get()
    if snap.exists:
        return snap.to_dict()
    snap = db.document(f'users/{uid}/garminDailies/{date_str}').get()
    return snap.to_dict() if snap.exists else {}


def _build_daily_context(uid: str) -> dict:
    today_str = date.today().isoformat()
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}

    today_data = _get_wellness_for_date(uid, today_str)

    week_data = []
    for i in range(7):
        d = (date.today() - timedelta(days=i)).isoformat()
        entry = _get_wellness_for_date(uid, d)
        if entry:
            week_data.append(entry)

    health_entries = []
    health_q = db.collection(f'users/{uid}/healthLog').order_by(
        'date', direction='DESCENDING'
    ).limit(20)
    for doc_snap in health_q.stream():
        health_entries.append(doc_snap.to_dict())

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
    text = text.strip()
    if text.startswith('```'):
        first_nl = text.index('\n')
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


def _resolve_plan_week_start(param: str = '') -> date:
    """Resolve which week the plan is for.
    If a date string is supplied, snap to its Monday. Otherwise use a
    smart default: Mon-Wed → this week, Thu-Sun → next week.
    """
    if param:
        try:
            d = date.fromisoformat(param[:10])
            return d - timedelta(days=d.weekday())  # snap to Monday
        except (ValueError, TypeError):
            pass
    today = date.today()
    if today.weekday() <= 2:
        return today - timedelta(days=today.weekday())
    return today + timedelta(days=(7 - today.weekday()))


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
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    user_context_text = (req.data.get('context') or '').strip() if req.data else ''
    user_context_text = user_context_text[:2000]  # cap

    week_start_param = (req.data.get('weekStartDate') or '').strip() if req.data else ''
    week_start = _resolve_plan_week_start(week_start_param)
    week_end = week_start + timedelta(days=6)

    context = _build_daily_context(uid)
    context['planWeekStartDate'] = week_start.isoformat()
    context['planWeekEndDate'] = week_end.isoformat()
    client = _get_anthropic_client()

    user_message = json.dumps(context, default=str)
    target_week_note = (
        f'PLAN FOR THE WEEK STARTING {week_start.isoformat()} (Monday) '
        f'THROUGH {week_end.isoformat()} (Sunday).'
    )
    if user_context_text:
        user_message = (
            f'{target_week_note}\n\n'
            f'USER CONTEXT FOR THIS WEEK (treat as hard constraints):\n{user_context_text}\n\n'
            f'TRAINING DATA:\n{user_message}'
        )
    else:
        user_message = f'{target_week_note}\n\nTRAINING DATA:\n{user_message}'

    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=3000,
        system=WEEKLY_PLAN_PROMPT,
        messages=[{'role': 'user', 'content': user_message}],
    )

    result = _parse_ai_json(response.content[0].text)

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
        'userContext': user_context_text or None,
        'createdAt': firestore.SERVER_TIMESTAMP,
        'generatedBy': 'claude-sonnet-4-5-20250929',
    })

    # Persist last-used context so the next Generate modal can prefill it
    if user_context_text:
        db.document(f'users/{uid}').set({
            'lastPlanContext': user_context_text,
        }, merge=True)

    return {
        'status': 'ok',
        'planId': plan_ref.id,
        'sessionCount': len(sessions),
        'summary': result.get('weekSummary', ''),
    }


ADJUST_PLAN_INSTRUCTIONS = """

YOU ARE MODIFYING AN EXISTING PLAN, NOT CREATING A NEW ONE.
- Make the SMALLEST changes necessary to satisfy the user's adjustment request
- Preserve unmodified sessions exactly as they are (same day, slot, type, title, durationMinutes, workoutScript, descriptions)
- Output the FULL updated sessions array — do not return a diff
- Total planned minutes should stay near the original unless the request implies otherwise
- weekSummary should briefly describe what changed (1-2 sentences)
"""


# ══════════════════════════════════════════════════════
# AI MODIFY PLAN
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    secrets=[ANTHROPIC_KEY_SECRET, ENCRYPTION_KEY_SECRET],
)
def ai_modify_plan(req: https_fn.CallableRequest) -> dict:
    """Adjust an existing plan with a small ad-hoc change.
    If the plan was previously pushed to intervals.icu, the events are
    automatically re-pushed so the user's calendar stays in sync.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    plan_id = req.data.get('planId')
    instruction = (req.data.get('instruction') or '').strip()
    if not plan_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='planId is required',
        )
    if not instruction:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='Instruction is required',
        )
    instruction = instruction[:500]

    plan_ref = db.document(f'users/{uid}/trainingPlans/{plan_id}')
    plan_snap = plan_ref.get()
    if not plan_snap.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Plan not found',
        )
    plan = plan_snap.to_dict()

    payload = {
        'currentPlan': {
            'weekStartDate': plan.get('weekStartDate'),
            'weekEndDate': plan.get('weekEndDate'),
            'summary': plan.get('summary'),
            'focusAreas': plan.get('focusAreas'),
            'totalPlannedMinutes': plan.get('totalPlannedMinutes'),
            'sessions': plan.get('sessions', []),
        },
        'adjustmentRequest': instruction,
        'userProfile': _build_daily_context(uid).get('user', {}),
    }

    client = _get_anthropic_client()
    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=3000,
        system=WEEKLY_PLAN_PROMPT + ADJUST_PLAN_INSTRUCTIONS,
        messages=[{'role': 'user', 'content': json.dumps(payload, default=str)}],
    )
    result = _parse_ai_json(response.content[0].text)

    new_sessions = result.get('sessions') or []
    if not new_sessions:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message='AI returned no sessions; please try again.',
        )

    # Preserve session completion state by matching day+slot
    prior_sessions = plan.get('sessions') or []
    prior_completed = {
        ((s.get('day') or '').lower(), (s.get('slot') or '').lower()): s.get('completed', False)
        for s in prior_sessions
    }
    for s in new_sessions:
        key = ((s.get('day') or '').lower(), (s.get('slot') or '').lower())
        if prior_completed.get(key):
            s['completed'] = True
        else:
            s.setdefault('completed', False)

    plan_ref.set({
        'sessions': new_sessions,
        'summary': result.get('weekSummary', plan.get('summary', '')),
        'focusAreas': result.get('focusAreas', plan.get('focusAreas', [])),
        'totalPlannedMinutes': result.get('totalPlannedMinutes', plan.get('totalPlannedMinutes', 0)),
        'lastAdjustment': instruction,
        'lastAdjustedAt': firestore.SERVER_TIMESTAMP,
    }, merge=True)

    # If the plan was already pushed to intervals.icu, re-push so the calendar matches.
    re_pushed = False
    prior_event_ids = plan.get('intervalsEventIds') or []
    if prior_event_ids:
        try:
            api_key = _get_user_api_key(uid)
            _delete_intervals_events(api_key, prior_event_ids)
            event_ids = []
            for idx, session in enumerate(new_sessions):
                ev_payload = _build_event_payload(plan_id, session, plan.get('weekStartDate'))
                if ev_payload is None:
                    event_ids.append(None)
                    continue
                try:
                    res = _intervals_post(api_key, '/athlete/0/events', ev_payload)
                    event_ids.append(res.get('id') if isinstance(res, dict) else None)
                except Exception as e:
                    print(f'Re-push session {idx} failed: {e}')
                    event_ids.append(None)
            plan_ref.set({
                'intervalsEventIds': event_ids,
                'pushedToIntervalsAt': firestore.SERVER_TIMESTAMP,
            }, merge=True)
            re_pushed = True
        except IntervalsAuthError:
            db.document(f'users/{uid}').set({
                'intervals': {'needs_reauth': True},
            }, merge=True)
        except https_fn.HttpsError:
            # already-not-connected etc — silently skip re-push
            pass
        except Exception as e:
            print(f'Plan re-push after adjustment failed for {uid}: {e}')

    return {
        'status': 'ok',
        'sessionCount': len(new_sessions),
        'summary': result.get('weekSummary', ''),
        'rePushed': re_pushed,
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
intervals.icu training/wellness data (sourced from Garmin and Hammerhead Karoo) and health logs.
Answer their question using this data. Be concise, specific, and actionable. Never diagnose
medical conditions. If asked about concerning symptoms, recommend consulting a doctor.""",
        messages=[
            {'role': 'user', 'content': f'My health data:\n{json.dumps(context, default=str)}\n\nQuestion: {question}'},
        ],
    )

    return {
        'status': 'ok',
        'answer': response.content[0].text,
    }


# ══════════════════════════════════════════════════════
# AI CONTEXT — focus-file compilation
# Generates personal markdown context files (training.focus.md, health.focus.md)
# from captured user answers + intervals.icu data. Stored in Firestore at
# users/{uid}/aiContext/{fileId}.
# ══════════════════════════════════════════════════════

TRAINING_FOCUS_PROMPT = """You compile a personal `training.focus.md` file capturing the
athlete's CURRENT training state. Output GitHub-flavored markdown only — no code fences
around the whole document, no preamble, no commentary. Follow the EXACT section structure.

OUTPUT FORMAT:
# Current Training Focus: {NAME}
## Current fitness state
## Current block intent
## Recent sessions
## Upcoming targets
## This week's structure
## Last updated: {DATE}

PRINCIPLES:
- The athlete may train across MULTIPLE sports — read their captured "sports" answer and
  treat the file as plural-sport unless they stated otherwise. Do not default to cycling.
- "Current fitness state" — short narrative on CTL (Fitness), ATL (Fatigue), Form (TSB),
  FTP if known, weight; what those numbers mean RIGHT NOW (fresh / accumulating fatigue /
  peak / detrained). 2-3 sentences max.
- "Current block intent" — what kind of work the athlete is doing this block, inferred
  from the recent session pattern PLUS their stated current target. 1-2 sentences.
- "Recent sessions" — 3-6 bullet lines summarising the last week of activities. Include
  sport, duration, character (easy / threshold / VO2 / long). Skip walks under 30min.
- "Upcoming targets" — events / goals from captured `currentTarget` and `longArcGoals`,
  with rough time horizon. If none, say "General fitness — no specific event."
- "This week's structure" — realistic week shape given the captured `lifePatterns`,
  `timeBudget`, and `workArounds`. Reference solo-parent days, work travel, etc. when
  relevant. Keep concrete (e.g. "Mon strength, Tue rest, Wed turbo, ...") rather than
  abstract.
- Total under 700 words. The file is consumed by AI assistants, not humans.
- No fabrication. If a data point is missing, omit it rather than inventing."""

HEALTH_FOCUS_PROMPT = """You compile a personal `health.focus.md` file capturing the
athlete's CURRENT health state. Output GitHub-flavored markdown only — no code fences
around the whole document, no preamble, no commentary. Follow the EXACT section structure.

OUTPUT FORMAT:
# Current Health State: {NAME}
## Current trends
## Active focus
## Things to watch
## Last updated: {DATE}

PRINCIPLES:
- "Current trends" — 7-14 day direction in sleep duration, RHR, HRV, weight. Talk
  direction (improving / stable / declining) with a number or two for anchor; don't
  dump raw timeseries. Reference the athlete's captured `goodSleep` baseline when
  commenting on current sleep.
- "Active focus" — what the athlete is currently testing or watching, taken from
  captured `activeConcerns` and `sleepSituation`.
- "Things to watch" — concrete signals to flag if they trip: e.g. "RHR creeping above
  baseline 5+ days," "HRV declining a week," "weight drift outside usual range."
  Tie these to the athlete's stated `recoveryFactors` and `healthHistory` where possible.
- Total under 500 words.
- No fabrication. Omit rather than invent."""


def _capture_for(uid: str, domain: str) -> dict:
    """Return a dict of {questionId: answer} for the given AI Context capture domain."""
    user = db.document(f'users/{uid}').get().to_dict() or {}
    raw = (user.get('aiContextCapture') or {}).get(domain) or {}
    out = {}
    for qid, entry in raw.items():
        if isinstance(entry, dict):
            ans = (entry.get('answer') or '').strip()
            if ans:
                out[qid] = ans
    return out


def _recent_wellness(uid: str, days: int = 14) -> list:
    """Recent wellness entries for the past N days, newest first."""
    today = date.today()
    out = []
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        snap = db.document(f'users/{uid}/wellnessDaily/{d}').get()
        if snap.exists:
            data = snap.to_dict()
            data['_date'] = d
            out.append(data)
    return out


def _recent_activities_for_compile(uid: str, days: int = 14) -> list:
    """Activities in the last N days, newest first; trimmed for prompt size."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    q = (
        db.collection(f'users/{uid}/activities')
        .order_by('startTimeLocal', direction='DESCENDING')
        .limit(60)
    )
    out = []
    for doc_snap in q.stream():
        d = doc_snap.to_dict() or {}
        start = (d.get('startTimeLocal') or '')[:10]
        if start < cutoff:
            continue
        out.append({
            'date': start,
            'sport': d.get('activityType', {}).get('typeKey') if isinstance(d.get('activityType'), dict) else d.get('rawType'),
            'name': d.get('activityName'),
            'durationMin': round((d.get('duration') or 0) / 60),
            'distanceKm': round((d.get('distance') or 0) / 1000, 1),
            'avgHR': d.get('averageHR'),
            'avgPower': d.get('averagePower'),
            'tss': d.get('tss'),
            'intensityFactor': d.get('intensityFactor'),
        })
    return out


def _latest_plan(uid: str) -> dict | None:
    """Most recent training plan, if any."""
    q = (
        db.collection(f'users/{uid}/trainingPlans')
        .order_by('createdAt', direction='DESCENDING')
        .limit(1)
    )
    for doc_snap in q.stream():
        return doc_snap.to_dict()
    return None


def _name_for(uid: str) -> str:
    user = db.document(f'users/{uid}').get().to_dict() or {}
    return user.get('displayName') or user.get('email', '').split('@')[0] or 'Athlete'


def _persist_ai_context_file(uid: str, file_id: str, domain: str, kind: str, content: str) -> None:
    db.document(f'users/{uid}/aiContext/{file_id}').set({
        'fileId': file_id,
        'domain': domain,
        'kind': kind,
        'content': content,
        'generatedAt': firestore.SERVER_TIMESTAMP,
        'generatedBy': 'claude-sonnet-4-5-20250929',
    }, merge=True)


@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_compile_training_focus(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    name = _name_for(uid)
    today_iso = date.today().isoformat()
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}
    profile = user_doc.get('profile') or {}
    capture = _capture_for(uid, 'training')
    activities = _recent_activities_for_compile(uid, days=10)
    wellness_today = (_recent_wellness(uid, days=1) or [{}])[0]
    plan = _latest_plan(uid)
    plan_summary = None
    if plan:
        plan_summary = {
            'weekStartDate': plan.get('weekStartDate'),
            'summary': plan.get('summary'),
            'focusAreas': plan.get('focusAreas'),
            'totalPlannedMinutes': plan.get('totalPlannedMinutes'),
            'sessions': [
                {
                    'day': s.get('day'),
                    'type': s.get('type'),
                    'title': s.get('title'),
                    'durationMinutes': s.get('durationMinutes'),
                    'completed': s.get('completed'),
                }
                for s in (plan.get('sessions') or [])
            ],
        }

    payload = {
        'name': name,
        'today': today_iso,
        'profile': {
            'ftp': profile.get('ftp'),
            'weight': profile.get('weight'),
            'age': profile.get('age'),
            'gender': profile.get('gender'),
            'thresholdHR': profile.get('thresholdHR'),
        },
        'currentMetrics': {
            'ctl': wellness_today.get('ctl'),
            'atl': wellness_today.get('atl'),
            'form': (wellness_today.get('ctl') or 0) - (wellness_today.get('atl') or 0)
                    if wellness_today.get('ctl') is not None or wellness_today.get('atl') is not None else None,
            'restingHR': wellness_today.get('restingHR'),
            'hrv': wellness_today.get('hrv') or wellness_today.get('hrvSDNN'),
        },
        'capturedContext': capture,
        'recentActivities': activities,
        'currentPlan': plan_summary,
    }

    client = _get_anthropic_client()
    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=2000,
        system=TRAINING_FOCUS_PROMPT.replace('{NAME}', name).replace('{DATE}', today_iso),
        messages=[{'role': 'user', 'content': json.dumps(payload, default=str)}],
    )
    content = response.content[0].text.strip()
    _persist_ai_context_file(uid, 'training_focus', 'training', 'focus', content)
    return {'status': 'ok', 'fileId': 'training_focus', 'characters': len(content)}


@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_compile_health_focus(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    name = _name_for(uid)
    today_iso = date.today().isoformat()
    capture = _capture_for(uid, 'health')
    wellness_recent = _recent_wellness(uid, days=14)

    # Trim wellness to fields relevant to the prompt (avoid blowing payload size)
    trimmed = []
    for w in wellness_recent:
        trimmed.append({
            'date': w.get('_date'),
            'sleepHours': round((w.get('sleepSecs') or 0) / 3600, 1) if w.get('sleepSecs') else None,
            'sleepScore': w.get('sleepScore'),
            'restingHR': w.get('restingHR'),
            'hrv': w.get('hrv') or w.get('hrvSDNN'),
            'weight': w.get('weight'),
        })

    payload = {
        'name': name,
        'today': today_iso,
        'capturedContext': capture,
        'wellnessLast14Days': trimmed,
    }

    client = _get_anthropic_client()
    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=1500,
        system=HEALTH_FOCUS_PROMPT.replace('{NAME}', name).replace('{DATE}', today_iso),
        messages=[{'role': 'user', 'content': json.dumps(payload, default=str)}],
    )
    content = response.content[0].text.strip()
    _persist_ai_context_file(uid, 'health_focus', 'health', 'focus', content)
    return {'status': 'ok', 'fileId': 'health_focus', 'characters': len(content)}


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
    users_ref = db.collection('users')
    for user_doc in users_ref.stream():
        uid = user_doc.id
        try:
            _compute_all_stats(uid)
        except Exception as e:
            print(f'Stats computation failed for {uid}: {e}')


@https_fn.on_call(region=REGION, timeout_sec=120)
def compute_stats_on_demand(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid
    _compute_all_stats(uid)
    return {'status': 'ok'}


def _compute_all_stats(uid: str):
    today = date.today()

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
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    export = {'exportedAt': datetime.utcnow().isoformat(), 'userId': uid}

    user_doc = db.document(f'users/{uid}').get()
    if user_doc.exists:
        settings = user_doc.to_dict()
        # Strip encrypted credentials from export
        intervals_cfg = settings.get('intervals', {}) or {}
        intervals_cfg.pop('encrypted_api_key', None)
        settings['intervals'] = intervals_cfg
        garmin_cfg = settings.get('garmin', {}) or {}
        garmin_cfg.pop('encrypted_tokens', None)
        settings['garmin'] = garmin_cfg
        export['settings'] = settings

    subcollections = [
        'wellnessDaily', 'garminDailies', 'activities', 'healthLog',
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
