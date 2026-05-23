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
    generation) can read them. Each field gets a {field}Source flag — 'intervals' when
    we pulled it, 'manual' when the user overrode in Settings. Manual sources are never
    overwritten. Returns the update dict applied (empty if nothing).
    """
    # Try /sport-settings first — per-sport FTP, LTHR, max HR, threshold pace
    sport_settings = []
    try:
        ss_result = _intervals_request(api_key, '/athlete/0/sport-settings', default=None)
        if isinstance(ss_result, list):
            sport_settings = ss_result
        elif isinstance(ss_result, dict):
            sport_settings = ss_result.get('sport_settings') or ss_result.get('sportSettings') or []
        print(f'intervals sport-settings: {len(sport_settings)} entries')
    except IntervalsAuthError:
        raise
    except Exception as e:
        print(f'sport-settings fetch failed: {e}')

    # Also fetch the athlete object for weight + general fields
    athlete = {}
    for path in ('/athlete/0', '/athlete/0/profile'):
        try:
            r = _intervals_request(api_key, path, default=None)
        except IntervalsAuthError:
            raise
        except Exception as e:
            print(f'{path} fetch failed: {e}')
            continue
        if not r:
            continue
        if isinstance(r, dict):
            inner = r.get('athlete') if isinstance(r.get('athlete'), dict) else r
            if isinstance(inner, dict) and inner:
                athlete = inner
                print(f'athlete keys from {path}: {list(athlete.keys())[:30]}')
                break

    # Pick from sport settings (Ride is primary for FTP; HR/maxHR from any sport that has them)
    def _from_settings(sport_id, *keys):
        for s in sport_settings:
            sid = s.get('id') or s.get('sportId') or s.get('sport')
            if sid == sport_id:
                for k in keys:
                    v = s.get(k)
                    if v not in (None, 0, ''):
                        return v
        return None

    def _from_athlete(*keys):
        for k in keys:
            v = athlete.get(k)
            if v not in (None, 0, ''):
                return v
        return None

    proposed = {}

    ftp = _from_settings('Ride', 'ftp', 'icu_ftp', 'indoor_ftp') or _from_athlete('icu_ftp', 'ftp')
    if ftp and ftp > 0:
        proposed['ftp'] = int(ftp)

    lthr = (_from_settings('Ride', 'lthr', 'icu_lthr')
            or _from_settings('Run', 'lthr', 'icu_lthr')
            or _from_athlete('lthr', 'icu_lthr'))
    if lthr and lthr > 0:
        proposed['thresholdHR'] = int(lthr)

    max_hr = (_from_settings('Ride', 'max_hr', 'maxHr')
              or _from_settings('Run', 'max_hr', 'maxHr')
              or _from_athlete('max_heartrate', 'icu_max_heartrate', 'maxHr'))
    if max_hr and max_hr > 0:
        proposed['maxHR'] = int(max_hr)

    resting_hr = _from_athlete('icu_resting_hr', 'restingHr')
    if resting_hr and resting_hr > 0:
        proposed['restingHR'] = int(resting_hr)

    threshold_pace = _from_settings('Run', 'threshold_pace', 'thresholdPace')
    if threshold_pace and threshold_pace > 0:
        proposed['thresholdPace'] = float(threshold_pace)

    weight = _from_athlete('weight', 'icu_weight')
    if weight and weight > 0:
        proposed['weight'] = round(float(weight), 1)

    print(f'intervals proposed profile: {proposed}')

    # Respect manual overrides — never overwrite a field marked source='manual'
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}
    existing_profile = user_doc.get('profile') or {}
    update = {}
    for field, value in proposed.items():
        source_key = f'{field}Source'
        if existing_profile.get(source_key) == 'manual':
            continue
        update[field] = value
        update[source_key] = 'intervals'

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


_CONCURRENT_START_WINDOW = timedelta(minutes=10)


def _dedup_concurrent_activities(activities: list) -> tuple[list, list]:
    """Group activities whose start times are within 10 minutes and keep the longest.

    intervals.icu syncs both the user's Garmin watch and Hammerhead Karoo, so the same
    ride often appears twice — sometimes with one started a few minutes after the
    other, or split into two recordings. The user can't run two sessions at once, so
    any pair starting within 10 minutes is treated as the same session.

    Returns (winners, losers) as lists of the original activity dicts.
    """
    if not activities:
        return [], []

    items = []
    for a in activities:
        start_str = a.get('start_date')
        elapsed = a.get('elapsed_time') or a.get('icu_duration') or 0
        start = None
        if start_str:
            try:
                start = datetime.fromisoformat(str(start_str).replace('Z', '+00:00'))
            except (ValueError, TypeError):
                start = None
        items.append({'act': a, 'start': start, 'elapsed': elapsed})

    items.sort(key=lambda it: (it['start'] is None, it['start'] or datetime.max.replace(tzinfo=None)))

    groups: list[list[dict]] = []
    for it in items:
        if it['start'] is None:
            groups.append([it])
            continue
        merged = False
        for g in groups:
            for member in g:
                if member['start'] is None:
                    continue
                if abs(it['start'] - member['start']) <= _CONCURRENT_START_WINDOW:
                    g.append(it)
                    merged = True
                    break
            if merged:
                break
        if not merged:
            groups.append([it])

    winners, losers = [], []
    for g in groups:
        if len(g) == 1:
            winners.append(g[0]['act'])
            continue
        winner = max(g, key=lambda x: x['elapsed'])
        for member in g:
            (winners if member is winner else losers).append(member['act'])
    return winners, losers


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

    winners, losers = _dedup_concurrent_activities(activities)
    if losers:
        print(f'intervals dedup {uid}: kept {len(winners)}, dropped {len(losers)} concurrent')

    batch = db.batch()
    write_count = 0
    for act in winners:
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

    # Delete any previously-written loser docs so the historical view stays clean
    if losers:
        batch = db.batch()
        del_count = 0
        for act in losers:
            act_id = act.get('id')
            if not act_id:
                continue
            batch.delete(db.document(f'users/{uid}/activities/intervals_{act_id}'))
            del_count += 1
            if del_count >= 450:
                batch.commit()
                batch = db.batch()
                del_count = 0
        if del_count > 0:
            batch.commit()

    # Mark plan sessions complete when activities pair with our pushed events
    try:
        _sync_plan_completion(uid, winners)
    except Exception as e:
        print(f'Plan completion sync failed for {uid}: {e}')

    # Refresh FTP / threshold HR / weight from intervals.icu athlete profile
    try:
        _refresh_athlete_profile(uid, api_key)
    except IntervalsAuthError:
        raise
    except Exception as e:
        print(f'Athlete profile refresh failed for {uid}: {e}')

    print(f'intervals sync done {uid}: {len(wellness)} wellness, {len(winners)} activities ({len(losers)} deduped)')
    return {'wellness': len(wellness), 'activities': len(winners), 'deduped': len(losers)}


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
# CLEANUP — one-shot dedup of historical concurrent activities
# ══════════════════════════════════════════════════════

@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.MB_512,
    timeout_sec=540,
)
def intervals_cleanup_overlapping(req: https_fn.CallableRequest) -> dict:
    """Walk the user's full activities collection and delete concurrent duplicates,
    keeping the longest in each cluster. Same heuristic as live sync (start times
    within 10 minutes = same session)."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid

    candidates = []
    for doc in db.collection(f'users/{uid}/activities').stream():
        data = doc.to_dict() or {}
        intervals_id = data.get('intervalsId')
        if not intervals_id:
            continue
        candidates.append({
            'id': intervals_id,
            'start_date': data.get('startTimeGMT'),
            'elapsed_time': data.get('duration'),
        })

    _, losers = _dedup_concurrent_activities(candidates)

    batch = db.batch()
    count = 0
    deleted_ids = []
    for act in losers:
        ref = db.document(f"users/{uid}/activities/intervals_{act['id']}")
        batch.delete(ref)
        deleted_ids.append(act['id'])
        count += 1
        if count >= 450:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()

    print(f'intervals cleanup {uid}: scanned {len(candidates)}, deleted {len(deleted_ids)}')
    return {
        'scanned': len(candidates),
        'deleted': len(deleted_ids),
        'deletedIds': deleted_ids,
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

TRAINING_FOCUS_PROMPT = """You compile the VitalSync-owned portion of `training.focus.md`.
Under the helper architecture, this file is split-ownership: VitalSync owns the
metric-grounded sections; the helper-side agent owns interpretive sections (block
intent, upcoming targets, week structure) using its broader cross-domain context.

Output GitHub-flavored markdown only — no code fences around the whole document,
no preamble, no commentary. Output ONLY the sections listed below — DO NOT output
"Current block intent", "Upcoming targets", "This week's structure" or any other
section, even if you have data for them. Those belong to the helper.

OUTPUT FORMAT (exactly these sections, in this order — no other H2 headings,
including no "Last updated" footer; the timestamp is exposed via API metadata):
# Current Training Focus: {NAME}
## Current fitness state
## Recent sessions

PRINCIPLES:
- The athlete may train across MULTIPLE sports — read their captured "sports" answer
  and treat the file as plural-sport. Do not default to cycling unless they said so.
- "Current fitness state" — short narrative on CTL (Fitness), ATL (Fatigue), Form
  (TSB), FTP if known, weight; what those numbers mean RIGHT NOW (fresh /
  accumulating fatigue / peak / detrained). 2-3 sentences max.
- "Recent sessions" — 3-6 bullet lines summarising the last week of activities.
  Include sport, duration, character (easy / threshold / VO2 / long). Skip walks
  under 30 min.
- Total under 350 words. Consumed by AI assistants, not humans.
- No fabrication. Omit a bullet rather than inventing."""

HEALTH_FOCUS_PROMPT = """You compile the VitalSync-owned portion of `health.focus.md`.
Under the helper architecture, this file is split-ownership: VitalSync owns the
metric-trend section; the helper-side agent owns interpretive sections (active focus,
things to watch) using its broader cross-domain context.

Output GitHub-flavored markdown only — no code fences around the whole document, no
preamble, no commentary. Output ONLY the section listed below — DO NOT output
"Active focus" or "Things to watch" or any other section.

OUTPUT FORMAT (exactly these sections, in this order — no other H2 headings,
including no "Last updated" footer; the timestamp is exposed via API metadata):
# Current Health State: {NAME}
## Current trends

PRINCIPLES:
- "Current trends" — 7-14 day direction in sleep duration, RHR, HRV, weight, AND
  any of these that are present in `healthLogLast14Days`:
  - Blood pressure (systolic/diastolic) — direction + most recent reading.
  - Mood and energy (1-5 scale) — direction and current.
  - Manually-logged weight + waist circumference — use these as authoritative
    where they exist; intervals.icu `weightFromIntervals` is a fallback only.
  - Glucose readings if logged (with `timing` like fasting / post-meal).
  - Cholesterol panel if logged recently.
  - Body fat % if logged.
  Talk direction (improving / stable / declining) with a number or two as anchor;
  don't dump raw timeseries.
- IMPORTANT — weight: when `healthLogLast14Days` contains weight entries, treat
  those as the user-confirmed truth. Intervals.icu often has stale or
  inconsistent weight readings. If manual entries disagree with intervals
  readings, trust the manual entries and call out the discrepancy briefly.
- Reference the athlete's captured `goodSleep` baseline when commenting on sleep.
- Total under 250 words.
- No fabrication. Omit a metric rather than invent. If a logged metric is sparse
  (1-2 readings in 14 days), say so — direction needs ≥3 points to claim."""


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


def _persist_ai_context_file(uid: str, file_id: str, domain: str, kind: str,
                              content: str, source: str = 'ui') -> str | None:
    """Write a freshly-compiled file. Captures the prior content into
    previousContent so the helper API can compute section-level diffs on the
    next read. Returns the prior content (or None if first compile).
    """
    ref = db.document(f'users/{uid}/aiContext/{file_id}')
    snap = ref.get()
    previous = (snap.to_dict() or {}).get('content') if snap.exists else None
    ref.set({
        'fileId': file_id,
        'domain': domain,
        'kind': kind,
        'content': content,
        'previousContent': previous,
        'generatedAt': firestore.SERVER_TIMESTAMP,
        'generatedBy': 'claude-sonnet-4-5-20250929',
        'compileSource': source,
    }, merge=True)
    return previous


import re

def _markdown_sections(content: str) -> dict:
    """Split markdown on top-level H2 headers; return {title: body}."""
    if not content:
        return {}
    sections = {}
    current_title = None
    current_lines = []
    for line in content.split('\n'):
        m = re.match(r'^##\s+(.+?)\s*$', line)
        if m:
            if current_title is not None:
                sections[current_title] = '\n'.join(current_lines).strip()
            current_title = m.group(1).strip()
            current_lines = []
        else:
            if current_title is not None:
                current_lines.append(line)
    if current_title is not None:
        sections[current_title] = '\n'.join(current_lines).strip()
    return sections


def _diff_sections(old: str, new: str) -> list:
    """Return list of H2 section titles whose body text differs between old and new."""
    old_sections = _markdown_sections(old)
    new_sections = _markdown_sections(new)
    changed = []
    for title, body in new_sections.items():
        if old_sections.get(title) != body:
            changed.append(title)
    for title in old_sections:
        if title not in new_sections and title not in changed:
            changed.append(title)
    return changed


def _run_compile_training_focus(uid: str, source: str = 'ui') -> dict:
    """Internal: compile training.focus.md and persist. Returns {content, previous}."""
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
    previous = _persist_ai_context_file(uid, 'training_focus', 'training', 'focus', content, source=source)
    return {'content': content, 'previous': previous}


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
    result = _run_compile_training_focus(req.auth.uid, source='ui')
    return {'status': 'ok', 'fileId': 'training_focus', 'characters': len(result['content'])}


def _activity_history_by_week(uid: str, weeks: int = 12) -> list:
    """Last N weeks of activity stats, oldest-first. Useful for me-file synthesis."""
    q = (
        db.collection(f'users/{uid}/activityStats')
        .where(filter=google.cloud.firestore.FieldFilter('periodType', '==', 'week'))
        .order_by('periodStart', direction='DESCENDING')
        .limit(weeks)
    )
    out = []
    for doc_snap in q.stream():
        d = doc_snap.to_dict() or {}
        out.append({
            'weekStart': d.get('periodStart'),
            'totalHours': round((d.get('totalDurationSeconds') or 0) / 3600, 1),
            'totalKm': round((d.get('totalDistanceMeters') or 0) / 1000),
            'activityCount': d.get('activityCount'),
            'byType': {
                t: {
                    'count': v.get('count'),
                    'hours': round((v.get('duration') or 0) / 3600, 1),
                }
                for t, v in (d.get('byType') or {}).items()
            },
        })
    return list(reversed(out))


def _ftp_samples_from_activities(uid: str, days: int = 180) -> list:
    """Recent ftpAtTime values from activities to show FTP progression."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    q = (
        db.collection(f'users/{uid}/activities')
        .order_by('startTimeLocal', direction='DESCENDING')
        .limit(200)
    )
    samples = []
    seen_ftps = set()
    for doc_snap in q.stream():
        d = doc_snap.to_dict() or {}
        start = (d.get('startTimeLocal') or '')[:10]
        if start < cutoff:
            continue
        ftp = d.get('ftpAtTime')
        if ftp and (start, ftp) not in seen_ftps:
            samples.append({'date': start, 'ftp': ftp})
            seen_ftps.add((start, ftp))
    # Keep only ~12 distinct samples spaced over the window for the prompt
    if len(samples) > 12:
        step = len(samples) // 12
        samples = samples[::step]
    return samples


def _wellness_summary(uid: str, days: int = 60) -> dict:
    """Aggregate wellness over N days into ranges + recent values for me-file synthesis."""
    today = date.today()
    sleeps, rhrs, hrvs, weights = [], [], [], []
    sleep_scores = []
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        snap = db.document(f'users/{uid}/wellnessDaily/{d}').get()
        if not snap.exists:
            continue
        w = snap.to_dict() or {}
        if w.get('sleepSecs'):
            sleeps.append(round(w['sleepSecs'] / 3600, 1))
        if w.get('sleepScore'):
            sleep_scores.append(int(w['sleepScore']))
        if w.get('restingHR'):
            rhrs.append(int(w['restingHR']))
        v = w.get('hrv') or w.get('hrvSDNN')
        if v:
            hrvs.append(int(v))
        if w.get('weight'):
            weights.append(round(float(w['weight']), 1))

    def _stats(vals):
        if not vals:
            return None
        return {
            'min': min(vals),
            'max': max(vals),
            'avg': round(sum(vals) / len(vals), 1),
            'samples': len(vals),
        }

    return {
        'days': days,
        'sleepHours': _stats(sleeps),
        'sleepScore': _stats(sleep_scores),
        'restingHR': _stats(rhrs),
        'hrv': _stats(hrvs),
        'weight': _stats(weights),
    }


def _recent_healthlog(uid: str, days: int = 14) -> list:
    """Recent healthLog entries (manually-logged BP, mood, weight, glucose,
    cholesterol, notes etc.), newest first, trimmed per entry type so the
    payload stays compact for the prompt.
    """
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    q = (
        db.collection(f'users/{uid}/healthLog')
        .order_by('date', direction='DESCENDING')
        .limit(300)
    )
    out = []
    for snap in q.stream():
        d = snap.to_dict() or {}
        if (d.get('date') or '') < cutoff:
            continue
        t = d.get('type')
        entry = {'type': t, 'date': d.get('date')}
        if t == 'weight':
            if d.get('value'): entry['weightKg'] = d['value']
            if d.get('waistCm'): entry['waistCm'] = d['waistCm']
            if d.get('bodyFat'): entry['bodyFatPct'] = d['bodyFat']
        elif t == 'blood_pressure':
            if d.get('systolic'): entry['systolic'] = d['systolic']
            if d.get('diastolic'): entry['diastolic'] = d['diastolic']
            if d.get('heartRate'): entry['heartRate'] = d['heartRate']
        elif t == 'glucose':
            if d.get('value') is not None: entry['mmolPerL'] = d['value']
            if d.get('timing'): entry['timing'] = d['timing']
        elif t == 'cholesterol':
            for f in ('totalCholesterol', 'hdl', 'ldl', 'triglycerides'):
                if d.get(f) is not None: entry[f] = d[f]
        elif t == 'mood':
            if d.get('mood'): entry['mood'] = d['mood']
            if d.get('energy'): entry['energy'] = d['energy']
            if d.get('notes'): entry['notes'] = d['notes']
        elif t == 'notes':
            if d.get('text'): entry['text'] = d['text']
        out.append(entry)
    return out


def _health_log_summary(uid: str, days: int = 60) -> dict:
    """Aggregated ranges across a window of healthLog entries for me-file synthesis."""
    entries = _recent_healthlog(uid, days=days)

    def _stats(vals):
        if not vals:
            return None
        return {
            'min': min(vals), 'max': max(vals),
            'avg': round(sum(vals) / len(vals), 1),
            'samples': len(vals),
        }

    bp_sys = [e['systolic'] for e in entries if e['type'] == 'blood_pressure' and e.get('systolic')]
    bp_dia = [e['diastolic'] for e in entries if e['type'] == 'blood_pressure' and e.get('diastolic')]
    bp_hr = [e['heartRate'] for e in entries if e['type'] == 'blood_pressure' and e.get('heartRate')]
    moods = [e['mood'] for e in entries if e['type'] == 'mood' and e.get('mood')]
    energies = [e['energy'] for e in entries if e['type'] == 'mood' and e.get('energy')]
    weights_manual = [e['weightKg'] for e in entries if e['type'] == 'weight' and e.get('weightKg')]
    waists = [e['waistCm'] for e in entries if e['type'] == 'weight' and e.get('waistCm')]
    body_fats = [e['bodyFatPct'] for e in entries if e['type'] == 'weight' and e.get('bodyFatPct')]
    glucoses = [e['mmolPerL'] for e in entries if e['type'] == 'glucose' and e.get('mmolPerL') is not None]
    cholesterol_recent = [e for e in entries if e['type'] == 'cholesterol'][:3]
    free_notes = [
        {'date': e.get('date'), 'text': e.get('notes') or e.get('text')}
        for e in entries
        if (e['type'] == 'mood' and e.get('notes')) or (e['type'] == 'notes' and e.get('text'))
    ][:10]

    return {
        'windowDays': days,
        'bloodPressure': {
            'systolic': _stats(bp_sys),
            'diastolic': _stats(bp_dia),
            'heartRate': _stats(bp_hr),
        } if bp_sys or bp_dia else None,
        'mood': _stats(moods),
        'energy': _stats(energies),
        'weightManual': _stats(weights_manual),
        'waistCm': _stats(waists),
        'bodyFatPct': _stats(body_fats),
        'glucose': _stats(glucoses),
        'recentCholesterol': cholesterol_recent,
        'recentNotes': free_notes,
    }



TRAINING_ME_PROMPT = """You compile a personal `training.me.md` file capturing the athlete's
DURABLE training identity — what kind of athlete they are, slow-moving truths that change
quarterly at most. Output GitHub-flavored markdown only. No code fences around the whole
document. No preamble. Follow the EXACT section structure.

OUTPUT FORMAT:
# Training Identity: {NAME}
## What kind of athlete I am
## Physiological baseline
## Long-arc goals
## Training constraints
## How I respond to training
## Why I do this
## Last updated: {DATE}

PRINCIPLES:
- The athlete may train across MULTIPLE sports — read their captured `sports` answer and
  treat the file as plural-sport. Do not default to cycling unless they said so.
- "What kind of athlete I am" — synthesise from captured `bestSelf`, captured `whySport`,
  and the activityHistoryByWeek pattern (which sports dominate, consistency vs sporadic,
  volume trend over months). 2-4 sentences. Concrete, not generic.
- "Physiological baseline" — FTP (current and trend from ftpSamples), threshold HR, max HR,
  resting HR baseline, weight range from wellnessSummary. Talk ranges, not single readings.
  Note when intervals.icu auto-updated values are recent vs stale.
- "Long-arc goals" — from captured `longArcGoals` and `currentTarget`. 2-3 bullets.
- "Training constraints" — from captured `lifePatterns`, `equipmentTerrain`, `workArounds`,
  `timeBudget`. Concrete things that don't change much.
- "How I respond to training" — captured `responsePatterns` is primary input. Augment
  briefly with anything obvious from the activityHistoryByWeek pattern (e.g. consistent
  ramp without breakdown suggests good volume tolerance).
- "Why I do this" — captured `whySport`. Quote or paraphrase as appropriate.
- Total under 1500 words. Consumed by AI assistants, not humans.
- No fabrication. If captured context is empty for a section, say "Not yet captured" rather
  than invent.
- If `previousFile` is provided, treat it as a starting point: preserve what still holds,
  refresh what has changed, drop what is superseded. Don't rewrite identical content."""


HEALTH_ME_PROMPT = """You compile a personal `health.me.md` file capturing the athlete's
DURABLE health identity. Output markdown only. No code fences. No preamble. EXACT structure.

OUTPUT FORMAT:
# Health Identity: {NAME}
## Baseline metrics
## Sleep patterns
## Recovery patterns
## Long-arc health priorities
## Last updated: {DATE}

PRINCIPLES:
- This file changes QUARTERLY at most.
- "Baseline metrics" — pull ALL of these from `wellnessSummary` and
  `healthLogSummary` (manual entries from the user's HealthLog):
  - RHR range (wellnessSummary.restingHR)
  - HRV baseline rMSSD/SDNN (wellnessSummary.hrv)
  - Sleep score range (wellnessSummary.sleepScore)
  - Weight range — prefer healthLogSummary.weightManual when present (user-
    confirmed), otherwise wellnessSummary.weight (intervals.icu)
  - Waist circumference range (healthLogSummary.waistCm)
  - Body fat % range (healthLogSummary.bodyFatPct)
  - Blood pressure baseline (healthLogSummary.bloodPressure — systolic/diastolic
    avg/range, with sample count if low)
  - Glucose baseline (healthLogSummary.glucose) if logged
  - Cholesterol baseline (healthLogSummary.recentCholesterol) — total / HDL /
    LDL / triglycerides; latest reading
  - Mood and energy average and range (healthLogSummary.mood / .energy) — only
    if there are enough samples to be meaningful (≥5)
  Talk ranges (e.g. "RHR baseline 48-54bpm") rather than single readings. Omit
  any metric with no data; do not invent placeholders.
- IMPORTANT — for weight, body fat, waist: manual entries from healthLogSummary
  are authoritative. intervals.icu's weight is fallback only.
- "Sleep patterns" — captured `goodSleep` is primary. Augment with average sleep
  hours and sleep score from wellnessSummary.
- "Recovery patterns" — captured `sleepResponse` and `recoveryFactors`. How they
  respond to poor sleep, what affects recovery. Reference the mood/energy
  pattern from healthLogSummary if present (e.g. "energy averages 3.5/5 with
  dips correlated to ...").
- "Long-arc health priorities" — captured `longArcHealth`. 2-3 priorities,
  concrete.
- Total under 1200 words.
- No fabrication. If a captured or logged field is empty, omit or say "Not yet
  captured."
- If `previousFile` is provided, refine rather than rewrite."""


def _existing_file_content(uid: str, file_id: str) -> str | None:
    snap = db.document(f'users/{uid}/aiContext/{file_id}').get()
    if not snap.exists:
        return None
    return (snap.to_dict() or {}).get('content')


def _run_compile_training_me(uid: str, source: str = 'ui') -> dict:
    """Internal: compile training.me.md and persist."""
    name = _name_for(uid)
    today_iso = date.today().isoformat()
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}
    profile = user_doc.get('profile') or {}
    capture = _capture_for(uid, 'training')
    history = _activity_history_by_week(uid, weeks=12)
    ftp_samples = _ftp_samples_from_activities(uid, days=180)
    wellness_summary = _wellness_summary(uid, days=60)
    previous_content = _existing_file_content(uid, 'training_me')

    payload = {
        'name': name,
        'today': today_iso,
        'profile': {
            'ftp': profile.get('ftp'),
            'thresholdHR': profile.get('thresholdHR'),
            'maxHR': profile.get('maxHR'),
            'restingHR': profile.get('restingHR'),
            'weight': profile.get('weight'),
            'age': profile.get('age'),
            'gender': profile.get('gender'),
        },
        'capturedContext': capture,
        'activityHistoryByWeek': history,
        'ftpSamples': ftp_samples,
        'wellnessSummary': wellness_summary,
        'previousFile': previous_content,
    }

    client = _get_anthropic_client()
    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=3000,
        system=TRAINING_ME_PROMPT.replace('{NAME}', name).replace('{DATE}', today_iso),
        messages=[{'role': 'user', 'content': json.dumps(payload, default=str)}],
    )
    content = response.content[0].text.strip()
    previous = _persist_ai_context_file(uid, 'training_me', 'training', 'me', content, source=source)
    return {'content': content, 'previous': previous}


@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.GB_1,
    timeout_sec=300,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_compile_training_me(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    result = _run_compile_training_me(req.auth.uid, source='ui')
    return {'status': 'ok', 'fileId': 'training_me', 'characters': len(result['content'])}


def _run_compile_health_me(uid: str, source: str = 'ui') -> dict:
    """Internal: compile health.me.md and persist."""
    name = _name_for(uid)
    today_iso = date.today().isoformat()
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}
    profile = user_doc.get('profile') or {}
    capture = _capture_for(uid, 'health')
    wellness_summary = _wellness_summary(uid, days=60)
    previous_content = _existing_file_content(uid, 'health_me')

    payload = {
        'name': name,
        'today': today_iso,
        'profile': {
            'restingHR': profile.get('restingHR'),
            'maxHR': profile.get('maxHR'),
            'weight': profile.get('weight'),
            'age': profile.get('age'),
            'gender': profile.get('gender'),
            'height': profile.get('height'),
        },
        'capturedContext': capture,
        'wellnessSummary': wellness_summary,
        'healthLogSummary': _health_log_summary(uid, days=60),
        'previousFile': previous_content,
    }

    client = _get_anthropic_client()
    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=2500,
        system=HEALTH_ME_PROMPT.replace('{NAME}', name).replace('{DATE}', today_iso),
        messages=[{'role': 'user', 'content': json.dumps(payload, default=str)}],
    )
    content = response.content[0].text.strip()
    previous = _persist_ai_context_file(uid, 'health_me', 'health', 'me', content, source=source)
    return {'content': content, 'previous': previous}


@https_fn.on_call(
    region=REGION,
    memory=options.MemoryOption.GB_1,
    timeout_sec=300,
    secrets=[ANTHROPIC_KEY_SECRET],
)
def ai_compile_health_me(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    result = _run_compile_health_me(req.auth.uid, source='ui')
    return {'status': 'ok', 'fileId': 'health_me', 'characters': len(result['content'])}


def _run_compile_health_focus(uid: str, source: str = 'ui') -> dict:
    """Internal: compile health.focus.md and persist."""
    name = _name_for(uid)
    today_iso = date.today().isoformat()
    capture = _capture_for(uid, 'health')
    wellness_recent = _recent_wellness(uid, days=14)
    health_log_recent = _recent_healthlog(uid, days=14)

    trimmed = []
    for w in wellness_recent:
        trimmed.append({
            'date': w.get('_date'),
            'sleepHours': round((w.get('sleepSecs') or 0) / 3600, 1) if w.get('sleepSecs') else None,
            'sleepScore': w.get('sleepScore'),
            'restingHR': w.get('restingHR'),
            'hrv': w.get('hrv') or w.get('hrvSDNN'),
            'weightFromIntervals': w.get('weight'),
        })

    payload = {
        'name': name,
        'today': today_iso,
        'capturedContext': capture,
        'wellnessLast14Days': trimmed,
        'healthLogLast14Days': health_log_recent,
    }

    client = _get_anthropic_client()
    response = client.messages.create(
        model='claude-sonnet-4-5-20250929',
        max_tokens=1500,
        system=HEALTH_FOCUS_PROMPT.replace('{NAME}', name).replace('{DATE}', today_iso),
        messages=[{'role': 'user', 'content': json.dumps(payload, default=str)}],
    )
    content = response.content[0].text.strip()
    previous = _persist_ai_context_file(uid, 'health_focus', 'health', 'focus', content, source=source)
    return {'content': content, 'previous': previous}


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
    result = _run_compile_health_focus(req.auth.uid, source='ui')
    return {'status': 'ok', 'fileId': 'health_focus', 'characters': len(result['content'])}


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


# ══════════════════════════════════════════════════════
# HELPER API — bearer-auth REST endpoints for the local helper agent
# Batched read of training/health .me/.focus markdown files with optional
# fresh recompile and per-file freshness/diff metadata.
# ══════════════════════════════════════════════════════

import hashlib
import secrets

_HELPER_API_FILES = {
    'training.focus': ('training', 'focus', _run_compile_training_focus),
    'training.me':    ('training', 'me',    _run_compile_training_me),
    'health.focus':   ('health',   'focus', _run_compile_health_focus),
    'health.me':      ('health',   'me',    _run_compile_health_me),
}

# Per-file ownership per the helper's split-ownership/v1 contract.
# Files in _SPLIT_FILES use splitOwnership: true with header + sections array.
# Other files use splitOwnership: false with whole-file content.
_SPLIT_FILES = {'training_focus', 'health_focus'}

# Section ID mapping per the spec — IDs are stable across title renames.
_SECTION_IDS = {
    'training_focus': {
        'Current fitness state': 'current-fitness-state',
        'Recent sessions': 'recent-sessions',
    },
    'health_focus': {
        'Current trends': 'current-trends',
    },
}

# Owner identifier for sections + headers VitalSync produces.
_VITALSYNC_OWNER = 'VitalSync'

# Contract version per the spec — included on every file entry.
_CONTRACT_VERSION = 'split-ownership/v1'


def _parse_header_and_sections(content: str):
    """Split markdown into (header_text, ordered list of (title, body)).
    Header = everything from start of file up to (but not including) the first
    H2 heading. Each section body excludes its '## title' line and is stripped
    of leading/trailing blank lines.
    """
    if not content:
        return ('', [])
    header_lines = []
    sections = []
    current_title = None
    current_lines = []
    in_body = False
    for line in content.split('\n'):
        m = re.match(r'^##\s+(.+?)\s*$', line)
        if m:
            in_body = True
            if current_title is not None:
                sections.append((current_title, '\n'.join(current_lines).strip()))
            current_title = m.group(1).strip()
            current_lines = []
        else:
            if not in_body:
                header_lines.append(line)
            else:
                current_lines.append(line)
    if current_title is not None:
        sections.append((current_title, '\n'.join(current_lines).strip()))
    header = '\n'.join(header_lines).rstrip()
    if header:
        header += '\n'
    return (header, sections)

# Staleness thresholds for refresh=if-stale (seconds)
_STALE_THRESHOLDS_SEC = {
    'focus': 6 * 3600,   # 6h for focus files
    'me':    24 * 3600,  # 24h for me files
}


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode('utf-8')).hexdigest()


def _validate_helper_token(token: str) -> dict | None:
    """Resolve a bearer token to {uid, scopes, prefix} or None."""
    if not token or not token.startswith('vsync_'):
        return None
    parts = token.split('_', 2)
    if len(parts) != 3:
        return None
    _, prefix, secret = parts
    if not prefix or not secret:
        return None
    snap = db.document(f'helperApiKeys/{prefix}').get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if data.get('revoked'):
        return None
    if _hash_secret(secret) != data.get('hashedSecret'):
        return None
    # Best-effort lastUsedAt update; failures don't fail the request
    try:
        db.document(f'helperApiKeys/{prefix}').set({
            'lastUsedAt': firestore.SERVER_TIMESTAMP,
        }, merge=True)
    except Exception:
        pass
    return {
        'uid': data.get('uid'),
        'scopes': data.get('scopes') or ['aicontext.read'],
        'prefix': prefix,
    }


def _has_scope(auth: dict, scope: str) -> bool:
    return scope in (auth.get('scopes') or [])


def _capture_last_updated_at(uid: str, domain: str):
    """Max updatedAt across captureAnswers in the domain. Prefers the denormalised
    _lastUpdatedAt sentinel written on every save; falls back to scanning entries."""
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}
    raw = (user_doc.get('aiContextCapture') or {}).get(domain) or {}
    denorm = raw.get('_lastUpdatedAt')
    if denorm is not None:
        return denorm
    latest = None
    for entry in raw.values():
        if not isinstance(entry, dict):
            continue
        ts = entry.get('updatedAt')
        if ts is None:
            continue
        if latest is None or ts > latest:
            latest = ts
    return latest


def _ts_to_iso(ts) -> str | None:
    """Firestore Timestamp / datetime -> ISO string (UTC, with Z)."""
    if ts is None:
        return None
    if isinstance(ts, str):
        return ts
    if hasattr(ts, 'isoformat'):
        s = ts.isoformat()
        # Normalise to ...Z if the timestamp is naive UTC
        if s.endswith('+00:00'):
            s = s[:-6] + 'Z'
        return s
    return str(ts)


def _seconds_since(ts) -> float | None:
    if ts is None:
        return None
    if hasattr(ts, 'timestamp'):
        return (datetime.utcnow().timestamp() - ts.timestamp())
    return None


def _file_freshness(uid: str, domain: str, kind: str, file_meta: dict) -> dict:
    """Compute freshness signals for a single file response."""
    user_doc = db.document(f'users/{uid}').get().to_dict() or {}
    intervals_cfg = user_doc.get('intervals') or {}
    intervals_synced_at = intervals_cfg.get('last_sync_at')
    capture_updated_at = _capture_last_updated_at(uid, domain)

    intervals_age_sec = _seconds_since(intervals_synced_at)
    intervals_status = 'fresh'
    if intervals_synced_at is None:
        intervals_status = 'broken'
    elif intervals_age_sec is not None and intervals_age_sec > 24 * 3600:
        intervals_status = 'broken'
    elif intervals_age_sec is not None and intervals_age_sec > 6 * 3600:
        intervals_status = 'stale'

    return {
        'intervals': {
            'lastSyncedAt': _ts_to_iso(intervals_synced_at),
            'ageMinutes': int(intervals_age_sec / 60) if intervals_age_sec is not None else None,
            'status': intervals_status,
        },
        'captureAnswers': {
            'lastUpdatedAt': _ts_to_iso(capture_updated_at),
        },
    }


def _should_recompile_if_stale(file_meta: dict, freshness: dict, kind: str) -> bool:
    """Return True if the cached file is older than the inputs that feed it."""
    generated_at = file_meta.get('generatedAt') if file_meta else None
    if not generated_at:
        return True  # never compiled
    gen_sec = _seconds_since(generated_at)
    threshold = _STALE_THRESHOLDS_SEC.get(kind, 6 * 3600)
    if gen_sec is not None and gen_sec > threshold:
        return True
    # If any input is newer than the file, stale
    intervals_synced_at = (db.document(f'users/{file_meta.get("_uid", "")}').get().to_dict() or {}).get('intervals', {}).get('last_sync_at') if file_meta.get('_uid') else None
    # Simpler: rely on freshness dict
    intervals_iso = freshness.get('intervals', {}).get('lastSyncedAt')
    capture_iso = freshness.get('captureAnswers', {}).get('lastUpdatedAt')
    gen_iso = _ts_to_iso(generated_at)
    if intervals_iso and gen_iso and intervals_iso > gen_iso:
        return True
    if capture_iso and gen_iso and capture_iso > gen_iso:
        return True
    return False


def _read_file_meta(uid: str, file_id: str) -> dict | None:
    snap = db.document(f'users/{uid}/aiContext/{file_id}').get()
    return snap.to_dict() if snap.exists else None


def _err_response(status: int, code: str, message: str, retriable: bool = False, **details):
    body = {
        'error': {
            'code': code,
            'message': message,
            'retriable': retriable,
        }
    }
    if details:
        body['error']['details'] = details
    return https_fn.Response(
        json.dumps(body),
        status=status,
        headers={'Content-Type': 'application/json'},
    )


def _build_file_entry(uid: str, file_spec: str, refresh: str, meta_only: bool) -> dict:
    """Compute a single file entry in the GET /v1/files response."""
    if file_spec not in _HELPER_API_FILES:
        return {
            'fileId': file_spec,
            'error': {'code': 'INVALID_FILE', 'message': f'Unknown file: {file_spec}'},
        }
    domain, kind, compile_fn = _HELPER_API_FILES[file_spec]
    file_id = f'{domain}_{kind}'

    file_meta = _read_file_meta(uid, file_id) or {}
    freshness = _file_freshness(uid, domain, kind, file_meta)

    sections_changed = []
    was_recompiled = False
    warnings = []

    if not meta_only:
        if refresh == 'force':
            try:
                result = compile_fn(uid, source='api')
                file_meta = _read_file_meta(uid, file_id) or {}
                freshness = _file_freshness(uid, domain, kind, file_meta)
                was_recompiled = True
                sections_changed = _diff_sections(result.get('previous') or '', result['content'])
            except Exception as e:
                print(f'helper_api compile failure ({file_id}): {e}')
                warnings.append(f'Compilation failed: {e}')
        elif refresh == 'if-stale':
            if _should_recompile_if_stale(file_meta, freshness, kind):
                try:
                    result = compile_fn(uid, source='api')
                    file_meta = _read_file_meta(uid, file_id) or {}
                    freshness = _file_freshness(uid, domain, kind, file_meta)
                    was_recompiled = True
                    sections_changed = _diff_sections(result.get('previous') or '', result['content'])
                except Exception as e:
                    print(f'helper_api compile failure ({file_id}): {e}')
                    warnings.append(f'Compilation failed: {e}')

    if freshness['intervals']['status'] == 'stale':
        warnings.append(f"intervals.icu sync is stale ({freshness['intervals']['ageMinutes']} min old)")
    elif freshness['intervals']['status'] == 'broken':
        warnings.append('intervals.icu sync has not run in over 24 hours or is not connected')

    is_split = file_id in _SPLIT_FILES
    persisted_content = file_meta.get('content') or ''

    # sectionsChanged restricted to titles VitalSync owns for split files.
    if was_recompiled and is_split:
        owned_titles = set((_SECTION_IDS.get(file_id) or {}).keys())
        sections_changed = [t for t in sections_changed if t in owned_titles]

    entry = {
        'fileId': file_id,
        'domain': domain,
        'kind': kind,
        'filename': f'{domain}.{kind}.md',
        'splitOwnership': is_split,
        'contractVersion': _CONTRACT_VERSION,
        'wasRecompiled': was_recompiled,
        'sectionsChanged': sections_changed,
        'freshness': freshness,
        'generatedAt': _ts_to_iso(file_meta.get('generatedAt')),
        'editedAt': _ts_to_iso(file_meta.get('editedAt')),
        'generatedBy': file_meta.get('generatedBy'),
        'compileSource': file_meta.get('compileSource'),
        'warnings': warnings,
    }
    if meta_only:
        return entry

    if is_split:
        # Split-ownership: header + sections only, NO content per spec
        header_text, parsed = _parse_header_and_sections(persisted_content)
        section_id_map = _SECTION_IDS.get(file_id, {})
        owned_sections = []
        for title, body in parsed:
            sid = section_id_map.get(title)
            if not sid:
                continue  # Skip helper-owned sections or unknown titles
            # Spec: body ends with trailing newline
            body_with_nl = body if body.endswith('\n') else body + '\n'
            owned_sections.append({
                'id': sid,
                'title': title,
                'content': body_with_nl,
                'ownedBy': _VITALSYNC_OWNER,
            })
        entry['header'] = {
            'content': header_text or '',
            'ownedBy': _VITALSYNC_OWNER,
        }
        entry['sections'] = owned_sections
    else:
        # Whole-file: content present, no header/sections
        entry['content'] = persisted_content if persisted_content else None

    return entry


@https_fn.on_request(
    region=REGION,
    memory=options.MemoryOption.GB_1,
    timeout_sec=540,
    secrets=[ANTHROPIC_KEY_SECRET, ENCRYPTION_KEY_SECRET],
)
def helper_api(req: https_fn.Request) -> https_fn.Response:
    """Bearer-auth REST endpoint for the local helper agent.
    Routes:
      GET  /v1/files                  — batched read (cached / if-stale)
      POST /v1/files/recompile        — batched force recompile
    """
    auth_header = req.headers.get('Authorization', '') or req.headers.get('authorization', '')
    if not auth_header.startswith('Bearer '):
        return _err_response(401, 'AUTH_MISSING', 'Missing Authorization: Bearer <token> header')
    token = auth_header[len('Bearer '):].strip()
    auth = _validate_helper_token(token)
    if not auth:
        return _err_response(401, 'AUTH_INVALID', 'Helper API key revoked or not found')
    if not _has_scope(auth, 'aicontext.read'):
        return _err_response(403, 'SCOPE_DENIED', 'Token lacks aicontext.read scope')

    path = req.path or '/'
    method = req.method or 'GET'

    if path == '/v1/files' and method == 'GET':
        files_param = req.args.get('files') if hasattr(req, 'args') else None
        if not files_param:
            files_param = ','.join(_HELPER_API_FILES.keys())
        refresh = (req.args.get('refresh') if hasattr(req, 'args') else None) or 'cached'
        meta_only = ((req.args.get('meta_only') if hasattr(req, 'args') else None) or 'false').lower() == 'true'
        if refresh not in ('cached', 'if-stale', 'force'):
            return _err_response(400, 'INVALID_PARAM', f'refresh must be cached|if-stale|force')

        requested = [f.strip() for f in files_param.split(',') if f.strip()]
        files_out = [_build_file_entry(auth['uid'], f, refresh, meta_only) for f in requested]
        return https_fn.Response(
            json.dumps({'files': files_out}, default=str),
            status=200,
            headers={'Content-Type': 'application/json'},
        )

    if path == '/v1/files/recompile' and method == 'POST':
        # Same payload as GET ?refresh=force
        try:
            body = req.get_json(silent=True) or {}
        except Exception:
            body = {}
        files_param = body.get('files') if isinstance(body, dict) else None
        if not files_param:
            files_param = ','.join(_HELPER_API_FILES.keys())
        if isinstance(files_param, list):
            requested = files_param
        else:
            requested = [f.strip() for f in str(files_param).split(',') if f.strip()]
        files_out = [_build_file_entry(auth['uid'], f, 'force', False) for f in requested]
        return https_fn.Response(
            json.dumps({'files': files_out}, default=str),
            status=200,
            headers={'Content-Type': 'application/json'},
        )

    return _err_response(404, 'NOT_FOUND', f'Unknown route: {method} {path}')


# ══════════════════════════════════════════════════════
# HELPER API KEY MANAGEMENT (callable, used by the web Settings tab)
# ══════════════════════════════════════════════════════

@https_fn.on_call(region=REGION)
def helper_api_create_key(req: https_fn.CallableRequest) -> dict:
    """Generate a new helper API key. Returns the FULL token once (not stored
    in plaintext). Subsequent reads only return the prefix and metadata."""
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid
    label = (req.data.get('label') if req.data else None) or ''
    label = str(label)[:60]

    prefix = secrets.token_hex(6)   # 12 chars
    secret = secrets.token_hex(32)  # 64 chars
    full_token = f'vsync_{prefix}_{secret}'

    db.document(f'helperApiKeys/{prefix}').set({
        'prefix': prefix,
        'uid': uid,
        'hashedSecret': _hash_secret(secret),
        'label': label,
        'scopes': ['aicontext.read'],
        'createdAt': firestore.SERVER_TIMESTAMP,
        'lastUsedAt': None,
        'revoked': False,
    })

    return {
        'token': full_token,
        'prefix': prefix,
        'label': label,
    }


@https_fn.on_call(region=REGION)
def helper_api_list_keys(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid
    keys = []
    q = db.collection('helperApiKeys').where(
        filter=google.cloud.firestore.FieldFilter('uid', '==', uid)
    )
    for doc_snap in q.stream():
        d = doc_snap.to_dict() or {}
        keys.append({
            'prefix': d.get('prefix'),
            'label': d.get('label') or '',
            'createdAt': _ts_to_iso(d.get('createdAt')),
            'lastUsedAt': _ts_to_iso(d.get('lastUsedAt')),
            'revoked': d.get('revoked', False),
        })
    keys.sort(key=lambda k: k.get('createdAt') or '', reverse=True)
    return {'keys': keys}


@https_fn.on_call(region=REGION)
def helper_api_revoke_key(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='Must be signed in',
        )
    uid = req.auth.uid
    prefix = (req.data.get('prefix') if req.data else None) or ''
    if not prefix:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='prefix is required',
        )
    snap = db.document(f'helperApiKeys/{prefix}').get()
    if not snap.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Key not found',
        )
    if (snap.to_dict() or {}).get('uid') != uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='Not your key',
        )
    db.document(f'helperApiKeys/{prefix}').set({'revoked': True}, merge=True)
    return {'status': 'ok'}
