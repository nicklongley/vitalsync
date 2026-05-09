# VitalSync Helper API

REST endpoint for the local AI helper agent to fetch personal `.me.md` and
`.focus.md` files for the **training** and **health** domains.

## Base URL

```
https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api
```

Cloud Functions v2 in europe-west2. The path `/v1/...` is appended after the
function name.

## Authentication

All endpoints require a bearer token:

```
Authorization: Bearer vsync_<prefix>_<secret>
```

**Generating a token**: VitalSync web app → Settings → **Helper API Keys** →
Generate New Key. The full token is shown once at creation; only the SHA-256
of the secret is persisted server-side. The 12-char prefix is visible
afterwards in the key list (with `lastUsedAt` and revoked status).

**Local storage**: recommended path `~/.config/personal-helper/vitalsync-key.txt`
with `chmod 600`.

**Scope**: single scope `aicontext.read`. Read-only across AI Context files.
Cannot modify user data, captured answers, intervals.icu credentials, or any
other Firestore collection.

**Multiple tokens**: allowed (e.g. one per machine). Each has its own
`lastUsedAt`. Revoke individually.

## Files exposed

Four files, addressed by `<domain>.<kind>`. Two are **split-ownership** (VitalSync
owns the metric-grounded sections; the helper owns interpretive sections), two are
**helper-authoritative** (the helper writes the canonical file in the helper folder;
VitalSync's compile is one input the helper synthesises alongside other domain
context).

| Spec | Ownership | VitalSync-owned sections | Helper-owned sections |
|---|---|---|---|
| `training.focus` | split | Current fitness state, Recent sessions | Current block intent, Upcoming targets, This week's structure |
| `training.me` | helper-authoritative | (whole VitalSync compile, as input) | helper writes the authoritative file |
| `health.focus` | split | Current trends | Active focus, Things to watch |
| `health.me` | helper-authoritative | (whole VitalSync compile, as input) | helper writes the authoritative file |

VitalSync compiles only the sections it owns for split files. For helper-authoritative
files, VitalSync compiles the full set of identity sections and the helper treats
them as input to its own synthesis.

Each compile ends with `## Last updated: YYYY-MM-DD` as a metadata marker — exposed
via the `generatedAt` response field, not as a content section.

## Endpoints

### `GET /v1/files`

Batched read of one or more files. Default: cache-only (no LLM call).

**Query parameters** (all optional):

| Param | Values | Default | Notes |
|---|---|---|---|
| `files` | comma-separated specs | all four | e.g. `training.focus,health.me` |
| `refresh` | `cached` \| `if-stale` \| `force` | `cached` | See refresh semantics below |
| `meta_only` | `true` \| `false` | `false` | Omit `content` from each entry — freshness probe |

#### Refresh semantics

- **`cached`** — return whatever is persisted. Never syncs upstream. Never
  recompiles. ~150 ms latency.
- **`if-stale`** — recompile when any of the following:
  - File has never been compiled, OR
  - File is older than the staleness threshold (6 h for `focus` files, 24 h for
    `me` files), OR
  - intervals.icu `lastSyncedAt` is newer than the file's `generatedAt`, OR
  - Capture answers `lastUpdatedAt` is newer than the file's `generatedAt`.
  Otherwise return cached. When recompiling, also triggers a fresh
  intervals.icu sync first.
- **`force`** — sync intervals.icu + recompile unconditionally.

**Response — 200 OK**

```json
{
  "files": [
    {
      "fileId": "training_focus",
      "domain": "training",
      "kind": "focus",
      "filename": "training.focus.md",
      "ownership": "split",
      "sections": [
        { "title": "Current fitness state", "content": "...", "ownedBy": "vitalsync" },
        { "title": "Recent sessions",        "content": "...", "ownedBy": "vitalsync" }
      ],
      "content": "# Current Training Focus: Nick\n## Current fitness state\n...",
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

#### Field reference

| Field | Type | Notes |
|---|---|---|
| `fileId` | string | `training_focus` \| `training_me` \| `health_focus` \| `health_me` |
| `domain` | string | `training` \| `health` |
| `kind` | string | `focus` \| `me` |
| `filename` | string | `<domain>.<kind>.md`, suitable as a save target |
| `ownership` | `split` \| `helper-authoritative` | See ownership contract below |
| `sections` | array | Per-section structured payload. Omitted when `meta_only=true`. See `sections` reference below |
| `content` | string \| null | Full persisted markdown VitalSync produced. Convenience field for clients that don't use `sections`. Omitted when `meta_only=true`. Null if never compiled. For split-ownership files, this is *only* the VitalSync portion — not a complete file |
| `generatedAt` | ISO 8601 UTC \| null | When the persisted file was last compiled |
| `editedAt` | ISO 8601 UTC \| null | When the persisted file was last hand-edited via the web UI |
| `generatedBy` | string | Anthropic model ID used for the last compile |
| `compileSource` | `api` \| `ui` | Which surface last touched the persisted version |
| `wasRecompiled` | bool | True if this request triggered a fresh compile |
| `sectionsChanged` | array<string> | VitalSync-owned section titles whose body differs from the previous compilation. Populated only when `wasRecompiled=true`. Helper-owned sections are never reported here — VitalSync doesn't produce them |
| `freshness.intervals.lastSyncedAt` | ISO 8601 UTC \| null | When intervals.icu sync last ran |
| `freshness.intervals.ageMinutes` | int \| null | Minutes since `lastSyncedAt` |
| `freshness.intervals.status` | `fresh` \| `stale` \| `broken` | `fresh` ≤ 6 h, `stale` 6–24 h, `broken` > 24 h or not connected |
| `freshness.captureAnswers.lastUpdatedAt` | ISO 8601 UTC \| null | Most recent answer save in the domain |
| `warnings` | array<string> | Human-readable advisories worth surfacing to the user |

#### `sections` reference

Each entry:

| Field | Type | Notes |
|---|---|---|
| `title` | string | The H2 section title from the spec (e.g. `"Current fitness state"`). Does NOT include the `## ` prefix |
| `content` | string | The body of that section in markdown. Does NOT include the `## <title>` header line |
| `ownedBy` | `vitalsync` | Always `vitalsync` — the API only returns sections VitalSync owns or contributes |

Notes:

- For `ownership: split` files, `sections` contains only the VitalSync-owned
  sections. The helper merges these with its own helper-owned sections to form the
  authoritative file in the helper folder.
- For `ownership: helper-authoritative` files, `sections` contains the full set of
  sections VitalSync compiled — these are VitalSync's *perspective* on the durable
  identity, intended as input to the helper's synthesis with career/work/cross-domain
  context. The helper writes the canonical file; VitalSync does not.
- The trailing `## Last updated: ...` marker is metadata. It is NOT included as a
  `sections[]` entry — the timestamp is exposed via `generatedAt`.

#### Ownership contract

Per-section, no file-level preamble. The helper merges based on `ownership` and the
`sections` returned. Helper-owned sections are unknown to VitalSync; do not infer
them from this API.

| File | Ownership | What VitalSync returns in `sections` |
|---|---|---|
| `training.focus` | split | `Current fitness state`, `Recent sessions` |
| `training.me` | helper-authoritative | full VitalSync compile (`What kind of athlete I am`, `Physiological baseline`, `Long-arc goals`, `Training constraints`, `How I respond to training`, `Why I do this`) — as VitalSync's perspective |
| `health.focus` | split | `Current trends` |
| `health.me` | helper-authoritative | full VitalSync compile (`Baseline metrics`, `Sleep patterns`, `Recovery patterns`, `Long-arc health priorities`) |

No file-level `<!-- source-system-owned -->` preamble is emitted in `content`.
Ownership lives at the section level.

#### Per-file errors inside a 200 response

If a single file in the batch is invalid (e.g. unknown spec), that entry is
replaced with an error object inside the array; the rest of the batch still
returns successfully:

```json
{
  "fileId": "training.bogus",
  "error": { "code": "INVALID_FILE", "message": "Unknown file: training.bogus" }
}
```

### `POST /v1/files/recompile`

Equivalent to `GET ?refresh=force` with POST semantics. Body is JSON.

**Body** (all optional):

```json
{
  "files": ["training.focus", "training.me"]
}
```

`files` may be a list or a comma-separated string. Omit to recompile all four.

**Response**: same shape as `GET`.

## HTTP error responses

Top-level errors (whole-request failures, not per-file):

```json
{
  "error": {
    "code": "AUTH_INVALID",
    "message": "Helper API key revoked or not found",
    "retriable": false
  }
}
```

| HTTP | `code` | `retriable` | Notes |
|---|---|---|---|
| 401 | `AUTH_MISSING` | false | No `Authorization: Bearer ...` header. |
| 401 | `AUTH_INVALID` | false | Token revoked, malformed, or not found. |
| 403 | `SCOPE_DENIED` | false | Token lacks `aicontext.read`. |
| 400 | `INVALID_PARAM` | false | Bad query param (e.g. unknown `refresh` value). |
| 404 | `NOT_FOUND` | false | Unknown route. |

The `retriable` field tells the helper whether to back off and try again
automatically. Per-file compilation failures don't fail the whole request —
they appear as warnings within the file entry, and the cached content is
still returned.

## Recommended client patterns

### Session start: cheap freshness probe

```bash
KEY=$(cat ~/.config/personal-helper/vitalsync-key.txt)
curl -s -H "Authorization: Bearer $KEY" \
  "https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api/v1/files?meta_only=true"
```

Inspect each file's `generatedAt`, `freshness.intervals.lastSyncedAt`, and
`freshness.captureAnswers.lastUpdatedAt`. Compare against your local
manifest. Fetch full content (without `meta_only`) only for files that have
changed since you last loaded them.

### Pull-and-review during a session

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api/v1/files?files=training.focus&refresh=if-stale"
```

Pulls the latest `training.focus`, recompiles only if intervals.icu data or
captured answers are fresher than the persisted file. Surface
`sectionsChanged` as the diff signal during the helper-side review gate.

### Force a fresh compile (e.g. quarterly me-file regen)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"files":["training.me"]}' \
  "https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api/v1/files/recompile"
```

### Reference Python client

```python
import json
import os
import urllib.request
import urllib.parse

BASE = 'https://europe-west2-vitalsync-7e04b.cloudfunctions.net/helper_api'
KEY_PATH = os.path.expanduser('~/.config/personal-helper/vitalsync-key.txt')


def _token() -> str:
    with open(KEY_PATH) as f:
        return f.read().strip()


def _request(method: str, path: str, query: dict | None = None, body: dict | None = None) -> dict:
    url = f'{BASE}{path}'
    if query:
        url += '?' + urllib.parse.urlencode(query)
    headers = {
        'Authorization': f'Bearer {_token()}',
        'Accept': 'application/json',
    }
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode('utf-8'))


def list_files(meta_only: bool = True) -> list:
    """Cheap probe — returns metadata for all four files, no content."""
    return _request('GET', '/v1/files', query={'meta_only': str(meta_only).lower()})['files']


def get_file(spec: str, refresh: str = 'cached') -> dict:
    """Fetch one file. spec like 'training.focus'."""
    res = _request('GET', '/v1/files', query={'files': spec, 'refresh': refresh})
    return res['files'][0]


def recompile(specs: list[str] | None = None) -> list:
    """Force fresh compilation of one or more files."""
    body = {'files': specs} if specs else {}
    return _request('POST', '/v1/files/recompile', body=body)['files']


# Example: pull all four with auto-refresh-if-stale
if __name__ == '__main__':
    res = _request('GET', '/v1/files', query={'refresh': 'if-stale'})
    for f in res['files']:
        print(f"{f['filename']}: generated {f.get('generatedAt')}, "
              f"recompiled={f.get('wasRecompiled')}, "
              f"changed={f.get('sectionsChanged')}")
        for w in f.get('warnings', []):
            print(f"  warning: {w}")
```

## Cost & rate limits

| Operation | Cost |
|---|---|
| `GET ?refresh=cached` or `meta_only=true` | 1–3 Firestore reads. Effectively free. |
| `GET ?refresh=if-stale` (sync + compile triggered) | One intervals.icu sync (~5 s) + one Anthropic Sonnet 4.5 call. ~£0.04–0.15 per file. |
| `POST /recompile` or `?refresh=force` | Same as above, per file. |
| `me`-file recompile | ~2× `focus` cost — output up to 3000 tokens, 60 days of wellness summary in payload. |

No hard rate limits enforced today. Practical guidance:

- `meta_only` polling: unlimited.
- `if-stale` calls per file: ~6 / hour is sensible.
- Forced recompiles per file: ~4 / hour, ~30 / day. Total LLM spend at heavy
  use stays under £5/day.

If usage trips concerning patterns, future versions may enforce these as
explicit `429 RATE_LIMITED` responses with `Retry-After` headers.

## Latency

| Call shape | p95 |
|---|---|
| `meta_only=true` or `refresh=cached` | ~150 ms |
| `if-stale` with no work needed | ~250 ms |
| `if-stale` with sync + focus compile | 8–15 s |
| `if-stale` with sync + me compile | 12–20 s |
| `force` | same as if-stale-with-work |

The Cloud Function timeout is 540 s. Wire timeouts shouldn't occur during
normal usage.

## Backwards compatibility with manual export

The web AI Context tab continues to support View / Edit / Generate / Export
`.md`. Both surfaces write to the same persisted document at
`users/{uid}/aiContext/{fileId}` so the most recent write wins.

The `compileSource` field distinguishes:
- `api` — last regenerated via this Helper API
- `ui` — last regenerated via the web AI Context tab's Generate button

The helper's own local manifest can record `lastImportedVia: 'api' | 'drop'`
independently for its own audit trail.

## Privacy posture

- Compiled files persist in Firestore under your user account, encrypted at
  rest by Google.
- Compilation invokes Anthropic's API (Claude Sonnet 4.5). Standard API
  privacy posture applies (no training on inputs by default). Zero Data
  Retention is **not currently enabled** at the project level. Flag this for
  helper-side decisions about how long to retain returned content.
- Captured answers (manually entered context in the AI Context tab) are
  included verbatim in compilation payloads. Treat the AI Context capture
  surface as text that will reach Anthropic at compile time.
- The Helper API never returns intervals.icu credentials, encrypted tokens,
  or any Firestore collection outside `aiContext`.

## Versioning

Path-prefix versioned at `/v1/...`. Breaking changes ship as `/v2/...`. The
current `/v1` surface will be maintained for at least 12 months after any
successor lands.

## Token lifecycle

| Event | Action |
|---|---|
| Generate | VitalSync Settings → Helper API Keys → Generate New Key. Token shown once. |
| Rotate | Generate a new token, switch the helper to it, then revoke the old prefix. |
| Revoke | Settings panel → Revoke. No confirmation; takes effect on the next request. |
| Multiple active | Allowed. Useful for per-machine or per-environment isolation. |

## Known limitations / open improvements

- No explicit `RATE_LIMITED` (429) responses today; cost is bounded by the
  practical guidance above.
- No per-answer sensitivity tagging on captured answers (everything captured
  is included in compilation). If you need to exclude specific captured text
  from compilation, edit it out via the web Settings or AI Context tab.
- No HEAD method — use `GET ?meta_only=true` instead.
- Section diff is title-list only; full text-level diff is not returned. The
  helper computes line-level diff locally if needed.
- ZDR is not yet enabled at the Anthropic project level.
- No file-level ownership preamble emitted in `content`. Ownership is signalled
  per-section via `ownership` + `sections[].ownedBy`.
- For `ownership: split` files, the persisted `content` field reflects only
  VitalSync's compiled portion and is NOT a complete file — the helper must
  merge with its own sections to form the authoritative version.
