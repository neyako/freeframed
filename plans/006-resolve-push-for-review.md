# Plan 006: DaVinci Resolve → FreeFrame "Push for Review" (auto-render current timeline, upload, get guest link)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- apps/api/routers/integrations.py apps/api/schemas/integrations.py apps/api/schemas/upload.py`
> These are the API contracts this tool calls. If any changed since this plan
> was written, compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.
> All files this plan **creates** are new (under `tools/resolve/`) — if any
> already exist, STOP and report (a previous run may be in progress).

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (new `tools/resolve/` directory)
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/003-review-ingest-endpoint.md (DONE — the `/integrations/review-ingest`
  endpoint must exist and be deployed/reachable for end-to-end use; this plan only *calls* it)
- **Category**: feature (integration / DX)
- **Planned at**: commit `c6eb4db`, 2026-06-29

## Why this matters

The editing team cuts in DaVinci Resolve. Today, getting a draft in front of a client means
manually exporting in Deliver, finding the file, uploading it somewhere, and pasting a link —
every revision. This plan adds a one-click **Workspace → Scripts → Utility → "FreeFrame: Push for
Review"** that renders the **current timeline** straight from Resolve, uploads it to FreeFrame's
service-to-service ingest endpoint (Plan 003), and prints back a reviewer-safe guest link
(`…/share/<token>`). It also records the returned token locally so the companion **Plan 007** can
later pull the reviewers' frame-accurate comments back into the timeline as markers. After this
plan, "send the latest cut for review" is a single menu click.

The whole bridge is a **stdlib-only Python tool** (no `pip install` into Resolve's interpreter),
so it runs under DaVinci Resolve's bundled Python on any editor's machine.

## Current state

This is a **net-new tool**. Nothing exists under `tools/resolve/` yet (confirm:
`ls tools/resolve 2>/dev/null` → no such directory). It talks to two things: the FreeFrame HTTP
API and the DaVinci Resolve scripting API. Both contracts are inlined below.

### FreeFrame ingest endpoint (the upload target) — `apps/api/routers/integrations.py`

The endpoint this tool POSTs to. **Do not modify it** — read it to match the contract exactly.

```python
router = APIRouter(prefix="/integrations", tags=["integrations"], route_class=IntegrationKeyRoute)
# IntegrationKeyRoute enforces the X-Api-Key header on every route in this router.

@router.post("/review-ingest", response_model=ReviewIngestResponse,
             status_code=status.HTTP_201_CREATED)
def review_ingest(
    background_tasks: BackgroundTasks,
    project_id: uuid.UUID = Form(...),
    asset_name: str = Form(...),
    mime_type: str = Form(...),
    file: UploadFile = File(...),
    permission: SharePermission = Form(SharePermission.comment),  # view | comment | approve
    allow_download: bool = Form(False),
    db: Session = Depends(get_db),
) -> ReviewIngestResponse:
    if mime_type not in ALLOWED_MIME_TYPES: ...  # 400
    if file.size is None: ...                    # 400
    if file.size > MAX_FILE_SIZE_BYTES: ...      # 400 (10 GB cap)
    # looks up project by project_id, creates Asset+Version+MediaFile, streams file to S3,
    # triggers transcode, mints a reviewer-safe share, returns:
```

`ReviewIngestResponse` (`apps/api/schemas/integrations.py`):

```python
class ReviewIngestResponse(BaseModel):
    asset_id: uuid.UUID
    version_id: uuid.UUID
    version_number: int
    token: str                       # the reviewer-share token — feed this to Plan 007
    url: str                         # public review page: {frontend_url}/share/{token}
    expires_at: Optional[datetime] = None
```

So the **request** is `multipart/form-data` to `POST {api_url}/integrations/review-ingest` with
header `X-Api-Key: <key>` and form fields: `project_id`, `asset_name`, `mime_type`, `file`,
optional `permission` (default `comment`), `allow_download` (default `false`). The **response** is
JSON with `token` and `url`.

Allowed video MIME types (`apps/api/schemas/upload.py`): include `video/mp4`, `video/quicktime`.
This tool renders **`video/mp4`** (H.264). `MAX_FILE_SIZE_BYTES = 10 GB`.

### Routing facts (verified)

`apps/api/main.py` registers routers with **no global prefix** (`app.include_router(integrations.router)`),
and the integrations router uses `prefix="/integrations"`. So the full path is
`{api_url}/integrations/review-ingest` where `api_url` is the FreeFrame **API origin** (the host
serving FastAPI, e.g. `http://localhost:8000` in dev). This is **not** necessarily the same as the
web app's `frontend_url`; the returned `url` already contains the correct public frontend origin —
the tool just prints it.

### DaVinci Resolve scripting API (the render source) — external facts

Confirmed against Blackmagic's scripting README (ships with Resolve under
**Help → Documentation → Developer**). These calls are stable across Resolve 18/19/20.

- **Connect** (works when run from Resolve's Scripts menu; the bundled module is importable there):
  ```python
  import DaVinciResolveScript as dvr_script
  resolve = dvr_script.scriptapp("Resolve")
  ```
  When a script is launched from **Workspace → Scripts**, Resolve also injects a global named
  `resolve` into the *entry script's* namespace (not into imported modules).
- **Navigate**: `pm = resolve.GetProjectManager()`, `project = pm.GetCurrentProject()`,
  `timeline = project.GetCurrentTimeline()`. `timeline.GetName()` → str.
  `timeline.GetUniqueId()` → str (Resolve 18+; may be absent on older — fall back to the name).
  `timeline.GetSetting("timelineFrameRate")` → str fps like `"24"` or `"23.976"`.
- **Render queue (Project object)**:
  - `project.SetCurrentRenderFormatAndCodec("mp4", "H264")` → Bool
  - `project.SetRenderSettings({ "SelectAllFrames": True, "TargetDir": "<dir>", "CustomName": "<name>" })` → Bool
    (`SelectAllFrames: True` renders the whole timeline and ignores MarkIn/MarkOut.)
  - `job_id = project.AddRenderJob()` → job id string (or `""`/None on failure)
  - `project.StartRendering([job_id])` → Bool
  - `project.IsRenderingInProgress()` → Bool
  - `project.GetRenderJobStatus(job_id)` → dict, e.g. `{"JobStatus": "Complete", "CompletionPercentage": 100}`
    (`JobStatus` ∈ `Ready | Rendering | Complete | Cancelled | Failed`)
- **Install location (macOS)** — scripts placed here appear under **Workspace → Scripts → Utility**:
  `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`

### Conventions to follow

- This tool is **stdlib-only** (no third-party imports) so it runs under Resolve's bundled Python.
  Use `urllib.request`, `json`, `os`, `tempfile`, `pathlib`, `typing`.
- Target **Python 3.8+**: put `from __future__ import annotations` at the top of every file, use
  `typing.Optional` / `typing.Dict` (NOT `X | Y` runtime unions), avoid `match` statements. Resolve's
  bundled interpreter can be as old as 3.6–3.8.
- All Resolve-touching code goes in the **entry script** guarded by `if __name__ == "__main__":`,
  so the shared module `freeframe_review.py` imports cleanly *without* Resolve present (this is what
  makes it unit-testable off-Resolve).
- Config and local state live under `~/.freeframe/` (`config.json`, `resolve_links.json`).

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`) | Expected |
|---------|-------------------------------------------|----------|
| Syntax-compile all tool files | `python3 -m py_compile tools/resolve/freeframe_review.py tools/resolve/freeframe_push_for_review.py` | exit 0 |
| Run the off-Resolve unit tests | `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` | all pass |
| Import the shared module (no Resolve needed) | `python3 -c "import sys; sys.path.insert(0,'tools/resolve'); import freeframe_review"` | exit 0 |

There is **no way to run DaVinci Resolve in CI** — Resolve-dependent behaviour is verified manually
(see Test plan). The pure logic (config, multipart encoding, HTTP client with a mocked socket,
sidecar store) **is** unit-tested and is the machine-checkable gate.

## Scope

**In scope** (create these files only):
- `tools/resolve/freeframe_review.py` — shared module: config loader, stdlib streaming-multipart
  HTTP client (`push_review`, `fetch_comments`), sidecar link store (`save_link`, `load_link`).
  (`fetch_comments` is included here so the client is complete; Plan 007 consumes it.)
- `tools/resolve/freeframe_push_for_review.py` — the menu entry script: render current timeline → upload → save token → print URL.
- `tools/resolve/config.example.json` — config template (**placeholders only, never a real key**).
- `tools/resolve/README.md` — install + configuration instructions for editors.
- `tools/resolve/tests/test_freeframe_review.py` — off-Resolve unit tests.

**Out of scope** (do NOT touch):
- `apps/api/**` — the ingest endpoint and all server code are done (Plan 003). This tool is a pure
  client. If the endpoint contract seems wrong, STOP — do not modify the server.
- `apps/web/**`, `plans/00{1..5}-*.md` — unrelated.
- Any `pip install` / changing Resolve's interpreter — the tool must stay stdlib-only.

## Git workflow

- Branch: `advisor/006-resolve-push-for-review`
- Conventional commits, matching this repo's log (e.g. `feat(tools): add Resolve push-for-review script`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the shared module `tools/resolve/freeframe_review.py`

Create the directory and file. The module must import with **no Resolve and no network**. Implement
exactly these public functions (you may add private helpers). Use this code as the contract — it is
load-bearing and must be reproduced faithfully:

```python
"""FreeFrame <-> DaVinci Resolve bridge: shared client + utilities.

Stdlib-only so it runs under DaVinci Resolve's bundled Python with no pip
installs. Imported by the Resolve entry scripts in this folder. Contains NO
Resolve API calls, so it imports and unit-tests fine off-Resolve.
"""
from __future__ import annotations

import io
import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

CONFIG_PATH = Path.home() / ".freeframe" / "config.json"
LINKS_PATH = Path.home() / ".freeframe" / "resolve_links.json"


class FreeFrameError(RuntimeError):
    """Any user-actionable failure in the bridge (bad config, HTTP error, ...)."""


# ── Config ───────────────────────────────────────────────────────────────────
def load_config(path: Path = CONFIG_PATH) -> Dict[str, Any]:
    if not path.exists():
        raise FreeFrameError(
            "FreeFrame config not found at %s. Copy tools/resolve/config.example.json "
            "to %s and fill in api_url, api_key, project_id." % (path, path)
        )
    try:
        cfg = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise FreeFrameError("Config at %s is not valid JSON: %s" % (path, exc)) from exc
    for key in ("api_url", "api_key", "project_id"):
        if not cfg.get(key):
            raise FreeFrameError("Config at %s is missing required key: %s" % (path, key))
    cfg["api_url"] = str(cfg["api_url"]).rstrip("/")
    return cfg


# ── Streaming multipart body (file streamed from disk, never read into RAM) ───
class _ChainedStream(io.RawIOBase):
    """Read-only stream: preamble bytes, then file contents, then epilogue."""

    def __init__(self, preamble: bytes, file_path: str, epilogue: bytes) -> None:
        self._parts = [io.BytesIO(preamble), open(file_path, "rb"), io.BytesIO(epilogue)]
        self._idx = 0

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:  # type: ignore[override]
        while self._idx < len(self._parts):
            n = self._parts[self._idx].readinto(b)
            if n:
                return n
            self._parts[self._idx].close()
            self._idx += 1
        return 0

    def close(self) -> None:
        for p in self._parts:
            try:
                p.close()
            except Exception:
                pass
        super().close()


def _build_multipart(fields: Dict[str, str], file_field: str, file_path: str,
                     file_name: str, file_ctype: str):
    """Return (headers, body_stream). body_stream streams the file from disk."""
    boundary = uuid.uuid4().hex
    pre = io.BytesIO()
    for name, value in fields.items():
        pre.write(("--%s\r\n" % boundary).encode())
        pre.write(('Content-Disposition: form-data; name="%s"\r\n\r\n' % name).encode())
        pre.write(("%s\r\n" % value).encode())
    pre.write(("--%s\r\n" % boundary).encode())
    pre.write(('Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
               % (file_field, file_name)).encode())
    pre.write(("Content-Type: %s\r\n\r\n" % file_ctype).encode())
    preamble = pre.getvalue()
    epilogue = ("\r\n--%s--\r\n" % boundary).encode()
    length = len(preamble) + os.path.getsize(file_path) + len(epilogue)
    headers = {
        "Content-Type": "multipart/form-data; boundary=%s" % boundary,
        "Content-Length": str(length),
    }
    return headers, _ChainedStream(preamble, file_path, epilogue)


# ── HTTP client ──────────────────────────────────────────────────────────────
def push_review(cfg: Dict[str, Any], file_path: str, asset_name: str, mime_type: str,
                permission: str = "comment", allow_download: bool = False,
                timeout: int = 3600) -> Dict[str, Any]:
    """POST a rendered video to /integrations/review-ingest. Returns the parsed
    JSON (incl. 'token' and 'url'). Raises FreeFrameError on any failure."""
    import urllib.error
    import urllib.request

    url = "%s/integrations/review-ingest" % cfg["api_url"]
    fields = {
        "project_id": str(cfg["project_id"]),
        "asset_name": asset_name,
        "mime_type": mime_type,
        "permission": permission,
        "allow_download": "true" if allow_download else "false",
    }
    headers, body = _build_multipart(fields, "file", file_path,
                                     os.path.basename(file_path), mime_type)
    headers["X-Api-Key"] = cfg["api_key"]
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise FreeFrameError("review-ingest failed: HTTP %s %s" % (exc.code, detail)) from exc
    except urllib.error.URLError as exc:
        raise FreeFrameError("Could not reach FreeFrame at %s: %s" % (url, exc.reason)) from exc


def fetch_comments(cfg: Dict[str, Any], token: str, timeout: int = 60) -> List[Dict[str, Any]]:
    """GET /share/{token}/comments (public, token-only). Returns a list of
    comment dicts (top-level comments with nested 'replies')."""
    import urllib.error
    import urllib.request

    url = "%s/share/%s/comments" % (cfg["api_url"], token)
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise FreeFrameError("fetch comments failed: HTTP %s %s" % (exc.code, detail)) from exc
    except urllib.error.URLError as exc:
        raise FreeFrameError("Could not reach FreeFrame at %s: %s" % (url, exc.reason)) from exc
    if not isinstance(data, list):
        raise FreeFrameError("Unexpected comments response (expected a JSON list).")
    return data


# ── Local sidecar: timeline -> {token, url, asset_id, fps, mark_in_frame} ─────
def save_link(timeline_key: str, data: Dict[str, Any]) -> None:
    LINKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    store: Dict[str, Any] = {}
    if LINKS_PATH.exists():
        try:
            store = json.loads(LINKS_PATH.read_text())
        except json.JSONDecodeError:
            store = {}
    store[timeline_key] = data
    LINKS_PATH.write_text(json.dumps(store, indent=2))


def load_link(timeline_key: str) -> Optional[Dict[str, Any]]:
    if not LINKS_PATH.exists():
        return None
    try:
        store = json.loads(LINKS_PATH.read_text())
    except json.JSONDecodeError:
        return None
    return store.get(timeline_key)
```

**Verify**:
- `python3 -m py_compile tools/resolve/freeframe_review.py` → exit 0
- `python3 -c "import sys; sys.path.insert(0,'tools/resolve'); import freeframe_review as f; print(f.FreeFrameError, f.load_config)"` → prints the class + function (no import error)

### Step 2: Create the entry script `tools/resolve/freeframe_push_for_review.py`

This is the file editors run from **Workspace → Scripts → Utility**. It renders the current
timeline to a temp `.mp4`, uploads it, saves the returned token, and prints the review URL.

```python
#!/usr/bin/env python3
"""FreeFrame: Push current timeline for review.

Run from DaVinci Resolve's Workspace > Scripts > Utility menu. Renders the
current timeline to a temporary H.264 mp4, uploads it to FreeFrame, prints the
reviewer link, and records the token so 'FreeFrame: Sync comments' (Plan 007)
can pull reviewer comments back as timeline markers.
"""
from __future__ import annotations

import datetime
import os
import sys
import tempfile
import time

# Make the sibling shared module importable when launched from the Scripts menu.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freeframe_review as ff  # noqa: E402


def _connect_resolve():
    # Prefer the global injected by Resolve's Scripts menu; fall back to the module.
    g = globals().get("resolve")
    if g is not None:
        return g
    try:
        import DaVinciResolveScript as dvr_script  # type: ignore
        return dvr_script.scriptapp("Resolve")
    except Exception as exc:  # pragma: no cover - requires Resolve
        raise ff.FreeFrameError(
            "Could not connect to DaVinci Resolve. Run this from Resolve's "
            "Workspace > Scripts > Utility menu. (%s)" % exc
        )


def main() -> int:
    cfg = ff.load_config()
    resolve_app = _connect_resolve()
    project = resolve_app.GetProjectManager().GetCurrentProject()
    if project is None:
        raise ff.FreeFrameError("No project is open in DaVinci Resolve.")
    timeline = project.GetCurrentTimeline()
    if timeline is None:
        raise ff.FreeFrameError("No timeline is open. Open the cut you want to send for review.")

    timeline_name = timeline.GetName()
    try:
        timeline_key = timeline.GetUniqueId()
    except Exception:
        timeline_key = timeline_name
    try:
        fps = float(timeline.GetSetting("timelineFrameRate"))
    except Exception:
        fps = float(project.GetSetting("timelineFrameRate"))

    tempdir = tempfile.mkdtemp(prefix="freeframe_")
    custom_name = "freeframe_review_%d" % int(time.time())

    if not project.SetCurrentRenderFormatAndCodec("mp4", "H264"):
        raise ff.FreeFrameError("Resolve rejected the mp4/H264 render format/codec.")
    if not project.SetRenderSettings({
        "SelectAllFrames": True,           # render the whole timeline
        "TargetDir": tempdir,
        "CustomName": custom_name,
    }):
        raise ff.FreeFrameError("Resolve rejected the render settings.")

    job_id = project.AddRenderJob()
    if not job_id:
        raise ff.FreeFrameError("Resolve could not add a render job.")
    if not project.StartRendering([job_id]):
        raise ff.FreeFrameError("Resolve could not start rendering.")

    print("Rendering '%s' ..." % timeline_name)
    while project.IsRenderingInProgress():
        time.sleep(2)
    status = project.GetRenderJobStatus(job_id) or {}
    if status.get("JobStatus") != "Complete":
        raise ff.FreeFrameError("Render did not complete (status=%s)." % status.get("JobStatus"))

    # Locate the rendered file (newest file in the temp dir).
    candidates = [os.path.join(tempdir, f) for f in os.listdir(tempdir)]
    candidates = [f for f in candidates if os.path.isfile(f) and os.path.getsize(f) > 0]
    if not candidates:
        raise ff.FreeFrameError("Render reported complete but no output file was found in %s." % tempdir)
    out_file = max(candidates, key=os.path.getmtime)

    asset_name = "%s — %s" % (timeline_name, datetime.date.today().isoformat())
    print("Uploading %.1f MB to FreeFrame ..." % (os.path.getsize(out_file) / 1e6))
    result = ff.push_review(cfg, out_file, asset_name=asset_name, mime_type="video/mp4")

    ff.save_link(timeline_key, {
        "token": result["token"],
        "url": result["url"],
        "asset_id": result.get("asset_id"),
        "fps": fps,
        "mark_in_frame": 0,            # whole-timeline render => video t=0 is timeline frame 0
        "timeline_name": timeline_name,
    })

    print("\n✅ Review link: %s\n" % result["url"])
    print("Reviewers can comment on this exact cut. Run 'FreeFrame: Sync comments'")
    print("on this timeline later to pull their notes back in as markers.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ff.FreeFrameError as exc:
        print("\n❌ %s\n" % exc)
        sys.exit(1)
```

**Verify**:
- `python3 -m py_compile tools/resolve/freeframe_push_for_review.py` → exit 0

### Step 3: Create `tools/resolve/config.example.json` (placeholders only)

```json
{
  "api_url": "http://localhost:8000",
  "api_key": "PASTE_INTEGRATION_API_KEY_HERE",
  "project_id": "PASTE_FREEFRAME_PROJECT_UUID_HERE",
  "_comment": "api_url is the FreeFrame API origin (serves /integrations and /share). api_key must equal the server's INTEGRATION_API_KEY. project_id is the FreeFrame project that holds review assets."
}
```

**NEVER** put a real key here. The value `PASTE_INTEGRATION_API_KEY_HERE` is a placeholder.

**Verify**: `python3 -c "import json; json.load(open('tools/resolve/config.example.json'))"` → exit 0.

### Step 4: Create `tools/resolve/README.md`

Write install + usage docs. It must cover, at minimum:

1. **Configure**: `mkdir -p ~/.freeframe && cp tools/resolve/config.example.json ~/.freeframe/config.json`,
   then edit `~/.freeframe/config.json` to set `api_url`, `api_key` (= the FreeFrame server's
   `INTEGRATION_API_KEY`), and `project_id` (the FreeFrame project UUID that holds review assets).
   Note that the config file holds a secret and should be `chmod 600`.
2. **Install into Resolve** (macOS): symlink the scripts into the Resolve Scripts dir so they appear
   under **Workspace → Scripts → Utility** and stay in sync with the repo:
   ```
   SCRIPTS="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility"
   mkdir -p "$SCRIPTS"
   ln -sf "$PWD/tools/resolve/freeframe_review.py" "$SCRIPTS/"
   ln -sf "$PWD/tools/resolve/freeframe_push_for_review.py" "$SCRIPTS/"
   # (Plan 007 adds freeframe_sync_comments.py here too.)
   ```
3. **Use**: open the cut, then **Workspace → Scripts → Utility → freeframe_push_for_review**. It
   renders the current timeline, uploads it, and prints the review link in the Scripts console.
4. **Note**: the tool renders the **whole** current timeline as H.264 mp4. The companion
   "Sync comments" script (Plan 007) reads back the reviewers' comments as markers.

**Verify**: `test -f tools/resolve/README.md` → exit 0.

### Step 5: Create the off-Resolve unit tests `tools/resolve/tests/test_freeframe_review.py`

These run with plain `unittest` — no Resolve, no network. Create `tools/resolve/tests/__init__.py`
(empty) too if needed for discovery. Cover:

1. **Config**: missing file → `FreeFrameError`; file missing `api_key` → `FreeFrameError`; valid file
   → returns dict with trailing slash stripped from `api_url`. (Write the config to a `tempfile`
   path and pass it to `load_config(path=...)`.)
2. **Multipart**: write a small temp file with known bytes; call `_build_multipart({"a":"1"}, "file",
   path, "clip.mp4", "video/mp4")`; read the whole `_ChainedStream`; assert the boundary appears, the
   field `a=1` block appears, the filename `clip.mp4` and the file's bytes appear, and that the body's
   length equals the `Content-Length` header value.
3. **push_review**: monkeypatch `urllib.request.urlopen` (via `unittest.mock.patch`) to return a
   fake context manager whose `.read()` yields `b'{"token":"tok","url":"http://x/share/tok"}'`.
   Capture the `Request` passed in; assert the URL is `…/integrations/review-ingest`, the
   `X-Api-Key` header is set, and the returned dict has `token == "tok"`.
4. **fetch_comments**: same mocking approach; `.read()` yields a JSON list; assert it round-trips.
   Also assert a non-list response raises `FreeFrameError`.
5. **Sidecar**: monkeypatch `freeframe_review.LINKS_PATH` to a temp path; `save_link("k", {...})`
   then `load_link("k")` returns the dict; `load_link("missing")` returns `None`.

The test file must add the tool dir to `sys.path` so it can `import freeframe_review`, e.g.:
```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freeframe_review as ff
```

**Verify**: `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` → all tests pass
(at least 5 test methods).

### Step 6: Full verification

**Verify** (all from `/Users/neyako/freeframed`):
- `python3 -m py_compile tools/resolve/freeframe_review.py tools/resolve/freeframe_push_for_review.py` → exit 0
- `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` → all pass
- `git -C /Users/neyako/freeframed status --porcelain` → only files under `tools/resolve/` are added

## Test plan

- **Automated (machine-checkable, no Resolve)**: the `unittest` suite in Step 5 covers config
  validation, the streaming multipart encoder, the HTTP client (mocked socket), and the sidecar
  store — the entire non-Resolve surface. This is the gate.
- **Manual (requires a real Resolve + a reachable FreeFrame with Plan 003 deployed)**, record results
  in your report; do not block the plan on it if you have no Resolve:
  1. Put a valid `~/.freeframe/config.json` (real `api_url`/`api_key`/`project_id`). Open a project +
     timeline in Resolve. Run **Scripts → Utility → freeframe_push_for_review**.
  2. Expect the console to show "Rendering…", "Uploading…", then `✅ Review link: …/share/<token>`.
  3. Open the link: it shows that one video with guest commenting and no other assets.
  4. Confirm `~/.freeframe/resolve_links.json` now has an entry keyed by the timeline id with the
     token, url, fps, and `mark_in_frame: 0`.
  If you have no Resolve instance, say so explicitly and rely on the automated gate + a careful
  re-read of the entry script's Resolve calls against the "Current state" API facts.

## Done criteria

ALL must hold:

- [ ] `python3 -m py_compile tools/resolve/freeframe_review.py tools/resolve/freeframe_push_for_review.py` exits 0
- [ ] `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` exits 0 with ≥5 passing tests
- [ ] `python3 -c "import sys; sys.path.insert(0,'tools/resolve'); import freeframe_review"` exits 0 (module imports with no Resolve, no network)
- [ ] `tools/resolve/config.example.json` is valid JSON and contains **no real secret** (only `PASTE_…` placeholders)
- [ ] `tools/resolve/README.md` exists and documents config + install + usage
- [ ] `grep -rnE "import requests|from requests" tools/resolve` → no matches (stdlib-only)
- [ ] Only files under `tools/resolve/` were added (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `apps/api/routers/integrations.py` no longer exposes `POST /integrations/review-ingest` with the
  `project_id`/`asset_name`/`mime_type`/`file` form fields and `X-Api-Key` auth (the contract in
  "Current state" drifted) — the client must match the live endpoint, and the server is out of scope.
- `ReviewIngestResponse` no longer returns `token` and `url` (Plan 007 depends on `token`).
- A verification command fails twice after a reasonable fix.
- You find yourself wanting to `pip install` anything into Resolve's Python, or to edit `apps/api/**`
  or `apps/web/**` — that means the approach drifted; STOP and report.

## Maintenance notes

- **Whole-timeline only (v1)**: this renders `SelectAllFrames: True`, so the uploaded video starts at
  the timeline's first frame and `mark_in_frame` is `0` — which is what makes Plan 007's marker math
  (`frame = round(seconds * fps)`) correct. If you later add an **in/out range** render, you MUST set
  `mark_in_frame` in the sidecar to the MarkIn frame so the comment timecodes still map to the right
  timeline frames (a comment at video-time 0 corresponds to MarkIn, not frame 0).
- **Streaming upload**: the multipart body streams the file from disk via `_ChainedStream`, so a
  multi-GB render does not blow memory. If a future executor's `urllib` build rejects the streamed
  body, the documented fallback is `requests` (`files={...}`) — but that reintroduces a pip
  dependency, so only do it if streaming genuinely fails.
- **One ingest = one new FreeFrame asset (version 1)**, matching Plan 003. Re-pushing the same
  timeline creates a *new* asset + link (and a new sidecar entry overwriting the old token). If the
  team wants version history inside FreeFrame, that needs Plan 003's endpoint to accept an `asset_id`
  (a separate, deliberate change).
- **Render jobs**: the script leaves its completed render job in the queue (it never calls
  `DeleteAllRenderJobs`, which would nuke the editor's other queued jobs). Harmless; revisit only if
  job buildup becomes annoying — delete only the specific `job_id` it created.
- Reviewer should scrutinise: the config file holds the integration secret (README says `chmod 600`);
  the secret never appears in the repo (only `PASTE_…` placeholders); and the tool is stdlib-only.
