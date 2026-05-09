# VitalSync Helper API

REST endpoint for the local AI helper agent to fetch personal `.me.md` and
`.focus.md` files for the **training** and **health** domains.

Implements contract version **`split-ownership/v1`**
(see `~/personal-context/specs/split-ownership.md`).

## Base URL

```
https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api
```

Cloud Functions v2 in europe-west2. The path `/v1/files...` is appended after
the function name.

## Authentication

All endpoints require a bearer token:

```
Authorization: Bearer vsync_<prefix>_<secret>
```

**Generating a token**: VitalSync web app → Settings → **Helper API Keys** →
Generate New Key. The full token is shown once at creation; only the SHA-256
of the secret is persisted server-side.

**Local storage**: recommended path `~/.config/personal-helper/vitalsync-key.txt`
with `chmod 600`.

**Scope**: single scope `aicontext.read`. Read-only across AI Context files.
Cannot modify any data or any other Firestore collection.

## Files exposed

Four files, addressed by `<domain>.<kind>`. Two use **split ownership**
(VitalSync owns the metric-grounded sections; the helper owns interpretive
sections); two are **whole-file** (`splitOwnership: false`) where VitalSync
emits the complete compile.

| Spec | `splitOwnership` | VitalSync sections / role |
|---|---|---|
| `training.focus` | `true` | sections: `current-fitness-state`, `recent-sessions` |
| `training.me` | `false` | whole-file compile (helper synthesises with cross-domain context) |
| `health.focus` | `true` | sections: `current-trends` |
| `health.me` | `false` | whole-file compile (helper synthesises with cross-domain context) |

For split files, VitalSync emits **no** `## Last updated` footer — the
timestamp is exposed via `generatedAt` in the API response. For whole-file
files, the compile still includes a `## Last updated: YYYY-MM-DD` H2 in
`content`.

VitalSync **does not** emit a `<!-- source-system-owned: VitalSync -->`
preamble anywhere. Ownership is signalled via `splitOwnership`,
`header.ownedBy`, and `sections[].ownedBy`.

## Endpoints

### `GET /v1/files`

Batched read of one or more files. Default: cache-only (no LLM call).

**Query parameters** (all optional):

| Param | Values | Default | Notes |
|---|---|---|---|
| `files` | comma-separated specs | all four | e.g. `training.focus,health.me` |
| `refresh` | `cached` \| `if-stale` \| `force` | `cached` | See refresh semantics below |
| `meta_only` | `true` \| `false` | `false` | Omit `header`, `sections`, `content` from each entry — freshness probe |

#### Refresh semantics

- **`cached`** — return whatever is persisted. Never syncs upstream. Never
  recompiles. ~150 ms latency.
- **`if-stale`** — recompile when any of the following:
  - File has never been compiled, OR
  - File is older than the staleness threshold (6 h for `focus`, 24 h for `me`), OR
  - intervals.icu `lastSyncedAt` is newer than the file's `generatedAt`, OR
  - Capture answers `lastUpdatedAt` is newer than the file's `generatedAt`.

  When recompiling, also triggers a fresh intervals.icu sync first.
- **`force`** — sync intervals.icu + recompile unconditionally.

#### Response — 200 OK (split file example)

```json
{
  "files": [
    {
      "fileId": "training_focus",
      "domain": "training",
      "kind": "focus",
      "filename": "training.focus.md",
      "splitOwnership": true,
      "contractVersion": "split-ownership/v1",
      "header": {
        "content": "# Current Training Focus: Nick\n",
        "ownedBy": "VitalSync"
      },
      "sections": [
        {
          "id": "current-fitness-state",
          "title": "Current fitness state",
          "content": "CTL 64, ATL 72, Form -8 ...\n",
          "ownedBy": "VitalSync"
        },
        {
          "id": "recent-sessions",
          "title": "Recent sessions",
          "content": "- Mon 60 min Z2 cycle ...\n",
          "ownedBy": "VitalSync"
        }
      ],
      "generatedAt": "2026-05-08T08:14:21Z",
      "editedAt": null,
      "generatedBy": "claude-sonnet-4-5-20250929",
      "compileSource": "api",
      "wasRecompiled": true,
      "sectionsChanged": ["Current fitness state"],
      "freshness": {
        "intervals": {
          "lastSyncedAt": "2026-05-08T08:12:03Z",
          "ageMinutes": 2,
          "status": "fresh"
        },
        "captureAnswers": {
          "lastUpdatedAt": "2026-05-07T19:30:00Z"
        }
      },
      "warnings": []
    }
  ]
}
```

#### Response — 200 OK (whole-file example)

```json
{
  "files": [
    {
      "fileId": "training_me",
      "domain": "training",
      "kind": "me",
      "filename": "training.me.md",
      "splitOwnership": false,
      "contractVersion": "split-ownership/v1",
      "content": "# Training Identity: Nick\n\n## What kind of athlete I am\n...\n## Last updated: 2026-05-08\n",
      "generatedAt": "2026-05-08T08:14:21Z",
      "editedAt": null,
      "generatedBy": "claude-sonnet-4-5-20250929",
      "compileSource": "api",
      "wasRecompiled": false,
      "sectionsChanged": [],
      "freshness": { "...": "..." },
      "warnings": []
    }
  ]
}
```

#### Field reference (top-level entry)

| Field | Type | Notes |
|---|---|---|
| `fileId` | string | `training_focus` \| `training_me` \| `health_focus` \| `health_me` |
| `domain` | string | `training` \| `health` |
| `kind` | string | `focus` \| `me` |
| `filename` | string | `<domain>.<kind>.md` |
| `splitOwnership` | bool | `true` ⇒ `header` + `sections` present, `content` omitted; `false` ⇒ `content` present, `header` and `sections` omitted |
| `contractVersion` | string | Always `"split-ownership/v1"` |
| `header` | object \| omitted | Present iff `splitOwnership: true` and not `meta_only`. See header schema below |
| `sections` | array \| omitted | Present iff `splitOwnership: true` and not `meta_only`. Ordered list of VitalSync-owned sections only. See section schema below |
| `content` | string \| null \| omitted | Present iff `splitOwnership: false` and not `meta_only`. Null if never compiled |
| `generatedAt` | ISO 8601 UTC \| null | When the persisted file was last compiled |
| `editedAt` | ISO 8601 UTC \| null | When the persisted file was last hand-edited via the web UI |
| `generatedBy` | string | Anthropic model ID used for the last compile |
| `compileSource` | `api` \| `ui` | Which surface last touched the persisted version |
| `wasRecompiled` | bool | True if this request triggered a fresh compile |
| `sectionsChanged` | array<string> | Section titles whose body differs from the previous compilation. For split files restricted to VitalSync-owned titles. Populated only when `wasRecompiled=true` |
| `freshness.intervals.lastSyncedAt` | ISO 8601 UTC \| null | When intervals.icu sync last ran |
| `freshness.intervals.ageMinutes` | int \| null | Minutes since `lastSyncedAt` |
| `freshness.intervals.status` | `fresh` \| `stale` \| `broken` | `fresh` ≤ 6 h, `stale` 6–24 h, `broken` > 24 h or not connected |
| `freshness.captureAnswers.lastUpdatedAt` | ISO 8601 UTC \| null | Most recent answer save in the domain |
| `warnings` | array<string> | Human-readable advisories |

#### `header` object

| Field | Type | Notes |
|---|---|---|
| `content` | string | Verbatim text from start of file up to (but not including) the first H2 heading. Includes the H1 line. Trailing newline included. |
| `ownedBy` | `"VitalSync"` | Always `"VitalSync"` for files this app emits |

#### `sections[]` object

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable kebab-case identifier. Persists across `title` renames. Join key for the helper's per-source ownership record |
| `title` | string | The H2 heading text as it should appear on disk. May change between syncs |
| `content` | string | Section body, starting after the H2 line, ending with a trailing newline. Does NOT include the `## <title>` heading |
| `ownedBy` | `"VitalSync"` | Always `"VitalSync"` |

VitalSync MUST NOT include sections owned by another source app or by the
helper. Per spec, the `sections` array is the authoritative complete set of
sections VitalSync owns at sync time. Helper-owned sections are unknown to
VitalSync.

#### Stable section IDs

| File | id | title |
|---|---|---|
| `training.focus` | `current-fitness-state` | Current fitness state |
| `training.focus` | `recent-sessions` | Recent sessions |
| `health.focus` | `current-trends` | Current trends |

These IDs are guaranteed stable across title renames. Helper-side syncs join
on `id`, not `title`.

### `POST /v1/files/recompile`

Equivalent to `GET ?refresh=force` with POST semantics.

**Body** (all optional):

```json
{ "files": ["training.focus", "training.me"] }
```

`files` may be a list or a comma-separated string. Omit to recompile all four.

**Response**: same shape as `GET`.

## Errors

Top-level errors (whole-request):

```json
{ "error": { "code": "AUTH_INVALID", "message": "...", "retriable": false } }
```

| HTTP | `code` | `retriable` | Notes |
|---|---|---|---|
| 401 | `AUTH_MISSING` | false | No `Authorization: Bearer ...` header |
| 401 | `AUTH_INVALID` | false | Token revoked, malformed, or not found |
| 403 | `SCOPE_DENIED` | false | Token lacks `aicontext.read` |
| 400 | `INVALID_PARAM` | false | Bad query param |
| 404 | `NOT_FOUND` | false | Unknown route |

## Recommended client patterns

### Session start: cheap freshness probe

```bash
KEY=$(cat ~/.config/personal-helper/vitalsync-key.txt)
curl -s -H "Authorization: Bearer $KEY" \
  "https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api/v1/files?meta_only=true"
```

### Pull-and-merge during a session

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api/v1/files?files=training.focus&refresh=if-stale"
```

For split files the helper merges `header` + the returned `sections` with
its own helper-owned sections per the contract's
[Sync merge algorithm](file:///~/personal-context/specs/split-ownership.md).

### Force a fresh compile

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"files":["training.focus","health.focus"]}' \
  "https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api/v1/files/recompile"
```

## Reference Python client

```python
import json, os, urllib.request, urllib.parse

BASE = 'https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api'
KEY_PATH = os.path.expanduser('~/.config/personal-helper/vitalsync-key.txt')

def _token() -> str:
    with open(KEY_PATH) as f:
        return f.read().strip()

def _request(method, path, query=None, body=None):
    url = f'{BASE}{path}'
    if query:
        url += '?' + urllib.parse.urlencode(query)
    headers = {'Authorization': f'Bearer {_token()}', 'Accept': 'application/json'}
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode('utf-8'))

def list_files(meta_only=True):
    return _request('GET', '/v1/files', query={'meta_only': str(meta_only).lower()})['files']

def get_file(spec, refresh='cached'):
    res = _request('GET', '/v1/files', query={'files': spec, 'refresh': refresh})
    return res['files'][0]

def recompile(specs=None):
    return _request('POST', '/v1/files/recompile', body={'files': specs} if specs else {})['files']
```

## Cost & latency

| Operation | Cost | p95 latency |
|---|---|---|
| `meta_only=true` or `refresh=cached` | Firestore reads only | ~150 ms |
| `if-stale` no work | Firestore reads | ~250 ms |
| `if-stale` with sync + focus compile | 1 sync + 1 Sonnet call | 8–15 s |
| `if-stale` with sync + me compile | 1 sync + 1 Sonnet call (larger) | 12–20 s |
| `force` | same as if-stale-with-work | same |

Per-call Anthropic spend ~£0.04–0.20. No hard rate limits today; practical
guidance: unlimited `meta_only`, ~6 `if-stale`/h per file, ~4 forced
recompiles/h per file.

The Cloud Function timeout is 540 s.

## Token lifecycle

| Event | Action |
|---|---|
| Generate | VitalSync Settings → Helper API Keys → Generate New Key. Token shown once. |
| Rotate | Generate new, switch helper, revoke old prefix. |
| Revoke | Settings panel → Revoke. Takes effect on next request. |
| Multiple active | Allowed (per-machine isolation). |

## Privacy posture

- Compiled files persist in Firestore under your user account, encrypted at
  rest by Google.
- Compilation invokes Anthropic's API (Claude Sonnet 4.5). Standard API
  privacy posture applies (no training on inputs by default). Zero Data
  Retention is **not currently enabled** at the project level.
- Captured answers (manually entered context in the AI Context tab) are
  included verbatim in compilation payloads.
- The Helper API never returns intervals.icu credentials or any Firestore
  collection outside `aiContext`.

## Versioning

Path-prefix versioned at `/v1/files`. Contract version
`split-ownership/v1` is included on every file entry as `contractVersion`.
Future revisions bump both.

## Known limitations

- No explicit `RATE_LIMITED` (429) responses today.
- No per-answer sensitivity tagging on captured answers.
- No HEAD method — use `GET ?meta_only=true`.
- Section-changed diff is title-list only; full text-level diff is not returned.
- ZDR is not yet enabled at the Anthropic project level.
