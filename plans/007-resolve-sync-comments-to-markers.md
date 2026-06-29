# Plan 007: DaVinci Resolve ← FreeFrame "Sync Comments" (pull reviewer comments onto the timeline as markers)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- apps/api/routers/comments.py apps/api/schemas/comment.py tools/resolve/freeframe_review.py`
> If `comments.py`/`comment.py` (the API contract) changed, compare the "Current
> state" excerpts before proceeding. `tools/resolve/freeframe_review.py` is
> created by **Plan 006** and is a hard dependency — see STOP conditions if it is
> absent.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`tools/resolve/`)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/006-resolve-push-for-review.md (reuses `tools/resolve/freeframe_review.py`:
  the `fetch_comments` client, the `load_link` sidecar store, and the stdlib-only conventions). The
  FreeFrame instance serving `GET /share/{token}/comments` must be reachable for end-to-end use.
- **Category**: feature (integration / DX)
- **Planned at**: commit `c6eb4db`, 2026-06-29

## Why this matters

Plan 006 lets an editor push a cut from DaVinci Resolve and get a reviewer link. Reviewers then
leave **frame-accurate comments** in FreeFrame ("at 0:42 the title is too small"). Today those
notes live only in the web UI — the editor reads them in a browser and manually scrubs the Resolve
timeline to each one. This plan closes the loop: a **Workspace → Scripts → Utility → "FreeFrame:
Sync Comments"** that fetches the reviewers' comments for the cut that was pushed from *this*
timeline and drops a **timeline marker** at each commented frame, with the reviewer's name and note
in the marker text. The editor opens the timeline, runs one menu item, and every piece of feedback
is sitting on the exact frame it refers to — green if the reviewer marked it resolved, yellow if
not. Re-running is idempotent (it replaces the FreeFrame markers, never duplicates them).

## Current state

### Dependency from Plan 006: `tools/resolve/freeframe_review.py`

Plan 006 created this stdlib-only shared module. This plan **adds three pure functions to it**
(`_author_name`, `flatten_comments`, `comment_to_marker`) and **creates one new entry script**.
The functions already present that this plan relies on:

```python
def fetch_comments(cfg, token, timeout=60) -> List[Dict[str, Any]]:
    """GET {api_url}/share/{token}/comments — returns a list of comment dicts."""

def load_link(timeline_key) -> Optional[Dict[str, Any]]:
    """Reads ~/.freeframe/resolve_links.json; returns {token,url,asset_id,fps,mark_in_frame,...}."""

def load_config(path=CONFIG_PATH) -> Dict[str, Any]:
    """Returns {api_url, api_key, project_id, ...} from ~/.freeframe/config.json."""

class FreeFrameError(RuntimeError): ...
```

If `freeframe_review.py` does not exist or lacks `fetch_comments`/`load_link`, **STOP** — Plan 006
must land first.

### FreeFrame comments API (the data source) — `apps/api/routers/comments.py`

The public, token-only endpoint this tool reads. **Do not modify it.**

```python
@router.get("/share/{token}/comments")
def list_share_comments(token: str, asset_id: Optional[uuid.UUID] = None, db: Session = Depends(get_db)):
    """Public endpoint — list comments for a shared asset. No auth required."""
    link = validate_share_link(db, token)            # 404/403/410 if bad/disabled/expired token
    target_asset_id = link.asset_id or asset_id      # reviewer shares (Plan 002/003) set link.asset_id
    if not target_asset_id:
        return []
    top_level = db.query(Comment).filter(
        Comment.asset_id == target_asset_id,
        Comment.parent_id.is_(None),
        Comment.deleted_at.is_(None),
    ).order_by(Comment.created_at).all()
    return [_build_comment_response(c, db) for c in top_level]
```

Each item is a `CommentResponse` (`apps/api/schemas/comment.py`). The fields this tool uses:

```python
class CommentResponse(BaseModel):
    id: uuid.UUID
    timecode_start: Optional[float]   # SECONDS into the video; None for general comments
    timecode_end: Optional[float]
    body: str
    resolved: bool
    author: Optional[AuthorInfo] = None          # {id, name, avatar_url} for logged-in authors
    guest_author: Optional[GuestAuthorInfo] = None  # {id, name, email} for guest reviewers
    replies: list["CommentResponse"] = []        # nested replies (one level shown here)
    # ... created_at, attachments, reactions, annotation, etc. (unused by this tool)
```

Key facts that drive the marker math:
- `timecode_start` is **seconds** (a `float`) measured from the **start of the uploaded video**.
- Because Plan 006 renders the **whole timeline** (`SelectAllFrames: True`), video-time 0 == the
  timeline's first frame, and the sidecar stores `mark_in_frame: 0`. So:
  **marker frame = `mark_in_frame + round(timecode_start * fps)`**.
- Comments with `timecode_start == null` are general (not anchored to a frame) — skip them for markers.
- Replies are nested under their parent; fold them into the parent marker's note.

### DaVinci Resolve marker API — external facts (stable across Resolve 18/19/20)

- Navigate: `project = resolve.GetProjectManager().GetCurrentProject()`,
  `timeline = project.GetCurrentTimeline()`, `timeline.GetName()`, `timeline.GetUniqueId()` (18+),
  `timeline.GetSetting("timelineFrameRate")` → str fps.
- `timeline.AddMarker(frameId, color, name, note, duration, customData)` → Bool. `frameId` is an int
  **relative to the timeline start** (0 = first frame). `color` is a named string
  (valid: `Blue, Cyan, Green, Yellow, Red, Pink, Purple, Fuchsia, Rose, Lavender, Sky, Mint, Lemon,
  Sand, Cocoa, Cream`). `duration` int frames (use `1`). `customData` is an arbitrary string for
  round-tripping. **Two markers cannot share the same frame** — `AddMarker` returns `False` on a
  collision.
- `timeline.GetMarkers()` → dict `{ frameId: {color, name, note, duration, customData}, ... }`.
- `timeline.DeleteMarkerByCustomData(customData)` → Bool (deletes the first marker with that
  customData). Use this to make re-sync idempotent: delete prior FreeFrame markers before re-adding.

### Conventions to follow

Same as Plan 006 (it created the tool): **stdlib-only**, `from __future__ import annotations`,
Python 3.8+ typing (`typing.Optional`/`Dict`/`List`, no `X | Y` runtime unions, no `match`), all
Resolve calls confined to the entry script's `if __name__ == "__main__":` path so the pure helpers
stay unit-testable off-Resolve.

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`) | Expected |
|---------|-------------------------------------------|----------|
| Syntax-compile tool files | `python3 -m py_compile tools/resolve/freeframe_review.py tools/resolve/freeframe_sync_comments.py` | exit 0 |
| Run off-Resolve unit tests | `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` | all pass (006's + new) |
| Import shared module (no Resolve) | `python3 -c "import sys; sys.path.insert(0,'tools/resolve'); import freeframe_review as f; print(f.comment_to_marker)"` | prints the function |

DaVinci Resolve cannot run in CI; Resolve behaviour is verified manually (Test plan). The
marker-mapping logic **is** unit-tested and is the machine-checkable gate.

## Scope

**In scope**:
- `tools/resolve/freeframe_review.py` — **append** `_author_name`, `flatten_comments`,
  `comment_to_marker` (pure functions; no Resolve, no network). Do not alter Plan 006's existing
  functions.
- `tools/resolve/freeframe_sync_comments.py` — **create** the menu entry script.
- `tools/resolve/tests/test_freeframe_review.py` — **append** tests for the three new functions.
  (Plan 006 created this file; add test methods, don't rewrite existing ones.)
- `tools/resolve/README.md` — **append** a short "Sync comments" usage section and add the new
  script to the symlink-install snippet.

**Out of scope** (do NOT touch):
- `apps/api/**` — the comments endpoint is done and correct; this tool is a read-only client. If it
  seems wrong, STOP.
- Plan 006's `freeframe_push_for_review.py`, `config.example.json`, and the existing functions in
  `freeframe_review.py` — leave them as-is; this plan is additive.
- `plans/00{1..6}-*.md`, `apps/web/**` — unrelated.
- Anything requiring a `pip install` — stay stdlib-only.

## Git workflow

- Branch: `advisor/007-resolve-sync-comments`
- Conventional commits (e.g. `feat(tools): sync FreeFrame review comments to Resolve markers`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Append the pure mapping helpers to `tools/resolve/freeframe_review.py`

Add at the end of the file (after `load_link`). These contain **no Resolve and no network** calls so
they unit-test off-Resolve:

```python
# ── Comment -> marker mapping (pure; used by freeframe_sync_comments.py) ──────
_RESOLVED_COLOR = "Green"
_OPEN_COLOR = "Yellow"
_CUSTOM_PREFIX = "freeframe:"


def _author_name(comment: Dict[str, Any]) -> str:
    src = comment.get("author") or comment.get("guest_author") or {}
    return (src.get("name") or "Reviewer").strip() or "Reviewer"


def flatten_comments(comments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only top-level comments anchored to a timecode (markers need a frame).
    Replies stay nested under each kept comment for folding into the note."""
    return [c for c in comments if c.get("timecode_start") is not None]


def comment_to_marker(comment: Dict[str, Any], fps: float, mark_in_frame: int = 0) -> Dict[str, Any]:
    """Map one FreeFrame comment to Resolve AddMarker arguments.

    Returns {frameId, color, name, note, customData}. frameId is relative to the
    timeline start: mark_in_frame + round(timecode_start * fps).
    """
    seconds = float(comment["timecode_start"])
    frame_id = int(mark_in_frame) + int(round(seconds * float(fps)))
    if frame_id < 0:
        frame_id = 0
    color = _RESOLVED_COLOR if comment.get("resolved") else _OPEN_COLOR
    author = _author_name(comment)
    body = (comment.get("body") or "").strip()
    note_lines = ["%s: %s" % (author, body)]
    for reply in (comment.get("replies") or []):
        note_lines.append("  > %s: %s" % (_author_name(reply), (reply.get("body") or "").strip()))
    note = "\n".join(note_lines)
    first_line = (body.splitlines() or ["Comment"])[0]
    name = (first_line[:40] or "Comment")
    return {
        "frameId": frame_id,
        "color": color,
        "name": name,
        "note": note,
        "customData": "%s%s" % (_CUSTOM_PREFIX, comment.get("id", "")),
    }
```

**Verify**:
- `python3 -m py_compile tools/resolve/freeframe_review.py` → exit 0
- `python3 -c "import sys; sys.path.insert(0,'tools/resolve'); import freeframe_review as f; print(f.comment_to_marker({'timecode_start':2.0,'body':'hi','id':'x'}, 24))"`
  → prints a dict with `'frameId': 48` and `'color': 'Yellow'`

### Step 2: Create the entry script `tools/resolve/freeframe_sync_comments.py`

```python
#!/usr/bin/env python3
"""FreeFrame: Sync review comments to timeline markers.

Run from DaVinci Resolve's Workspace > Scripts > Utility menu, with the timeline
that was pushed via 'FreeFrame: Push for Review' (Plan 006) open. Fetches the
reviewers' comments for that cut and drops a marker at each commented frame.
Re-running replaces the FreeFrame markers (idempotent).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freeframe_review as ff  # noqa: E402


def _connect_resolve():
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


def _resolve_token(timeline_key, timeline_name):
    """Find the share token for this timeline: sidecar first, then an optional
    review URL/token passed on the command line (e.g. when run from the console)."""
    link = ff.load_link(timeline_key) or ff.load_link(timeline_name)
    if link and link.get("token"):
        return link.get("token"), link
    if len(sys.argv) > 1 and sys.argv[1].strip():
        arg = sys.argv[1].strip()
        token = arg.rsplit("/share/", 1)[-1].strip("/") if "/share/" in arg else arg
        return token, {"token": token}
    raise ff.FreeFrameError(
        "No review link found for this timeline. Run 'FreeFrame: Push for Review' on it "
        "first, or pass the review URL/token as an argument."
    )


def main() -> int:
    cfg = ff.load_config()
    resolve_app = _connect_resolve()
    project = resolve_app.GetProjectManager().GetCurrentProject()
    if project is None:
        raise ff.FreeFrameError("No project is open in DaVinci Resolve.")
    timeline = project.GetCurrentTimeline()
    if timeline is None:
        raise ff.FreeFrameError("No timeline is open. Open the cut you sent for review.")

    timeline_name = timeline.GetName()
    try:
        timeline_key = timeline.GetUniqueId()
    except Exception:
        timeline_key = timeline_name

    token, link = _resolve_token(timeline_key, timeline_name)
    fps = float(link.get("fps") or timeline.GetSetting("timelineFrameRate"))
    mark_in_frame = int(link.get("mark_in_frame") or 0)

    comments = ff.fetch_comments(cfg, token)
    anchored = ff.flatten_comments(comments)
    if not anchored:
        print("No timecoded comments to sync (found %d comment(s) total)." % len(comments))
        return 0

    # Idempotent: remove markers this tool previously placed.
    existing = timeline.GetMarkers() or {}
    for _frame, info in existing.items():
        cd = (info or {}).get("customData") or ""
        if cd.startswith("freeframe:"):
            timeline.DeleteMarkerByCustomData(cd)

    placed = 0
    for comment in anchored:
        m = ff.comment_to_marker(comment, fps, mark_in_frame)
        frame = m["frameId"]
        # Resolve can't place two markers on one frame; nudge forward up to 1s if needed.
        added = False
        for offset in range(0, max(1, int(round(fps)))):
            if timeline.AddMarker(frame + offset, m["color"], m["name"], m["note"], 1, m["customData"]):
                added = True
                break
        if added:
            placed += 1
        else:
            print("  (skipped a comment near frame %d — could not place a marker)" % frame)

    print("\n✅ Placed %d marker(s) from FreeFrame review on '%s'." % (placed, timeline_name))
    print("Green = reviewer marked resolved, Yellow = open.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ff.FreeFrameError as exc:
        print("\n❌ %s\n" % exc)
        sys.exit(1)
```

**Verify**: `python3 -m py_compile tools/resolve/freeframe_sync_comments.py` → exit 0

### Step 3: Append tests for the new helpers

In `tools/resolve/tests/test_freeframe_review.py`, add test methods (keep Plan 006's tests intact):

1. **frame mapping**: `comment_to_marker({"timecode_start": 2.0, "body": "x", "id": "a"}, 24.0)`
   → `frameId == 48`; with `mark_in_frame=10` → `frameId == 58`; `timecode_start: 1.5, fps 30`
   → `frameId == 45` (rounding).
2. **color**: `resolved: True` → `color == "Green"`; absent/False → `color == "Yellow"`.
3. **note + author**: a comment with a `guest_author.name` and one reply → `note` starts with
   `"<guest name>: <body>"` and contains the reply line `"> <reply author>: <reply body>"`;
   a comment with neither author nor guest_author → author renders as `"Reviewer"`.
4. **flatten_comments**: a list mixing `timecode_start: null` and numeric entries → only the numeric
   ones are returned, order preserved.
5. **customData**: `customData == "freeframe:<id>"`.

**Verify**: `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` → all pass
(006's tests + ≥5 new methods).

### Step 4: Append to `tools/resolve/README.md`

Add a short section:
- Add `freeframe_sync_comments.py` to the symlink-install snippet from Plan 006.
- Usage: with the cut's timeline open, run **Workspace → Scripts → Utility → freeframe_sync_comments**.
  It reads the token saved when you pushed the cut, fetches the reviewers' comments, and places a
  marker at each timecoded comment (Green = resolved, Yellow = open). Re-running refreshes them.
- Note: comments without a timecode (general notes) are skipped; only frame-anchored comments become
  markers.

**Verify**: `grep -n "freeframe_sync_comments" tools/resolve/README.md` → at least one match.

### Step 5: Full verification

**Verify** (from `/Users/neyako/freeframed`):
- `python3 -m py_compile tools/resolve/freeframe_review.py tools/resolve/freeframe_sync_comments.py` → exit 0
- `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` → all pass
- `git -C /Users/neyako/freeframed status --porcelain` → only `tools/resolve/` files added/modified

## Test plan

- **Automated (gate, no Resolve)**: the new `unittest` methods fully cover the marker math
  (`comment_to_marker`), author/guest fallback, reply folding, and `flatten_comments` filtering.
- **Manual (requires Resolve + a reachable FreeFrame, and ideally a comment left on a pushed cut)**,
  record results; do not block on it without Resolve:
  1. After running Plan 006's push on a timeline, open the printed review link and leave a comment at
     a known time (e.g. pause at 5s, comment "test").
  2. Back in Resolve with the same timeline open, run **Scripts → Utility → freeframe_sync_comments**.
  3. Expect a marker to appear at frame ≈ `round(5 * timeline_fps)` with the note "<name>: test", and
     the console to print "Placed 1 marker(s)…".
  4. Run it again → still exactly one FreeFrame marker (idempotent, no duplicate).
  If you have no Resolve, say so and rely on the automated gate + re-reading the entry script against
  the marker-API facts in "Current state".

## Done criteria

ALL must hold:

- [ ] `python3 -m py_compile tools/resolve/freeframe_review.py tools/resolve/freeframe_sync_comments.py` exits 0
- [ ] `python3 -m unittest discover -s tools/resolve/tests -p 'test_*.py' -v` exits 0 with ≥5 new marker tests passing (006's tests still pass)
- [ ] `python3 -c "import sys; sys.path.insert(0,'tools/resolve'); import freeframe_review as f; print(f.comment_to_marker({'timecode_start':2.0,'body':'x','id':'a'},24)['frameId'])"` prints `48`
- [ ] `grep -n "freeframe_sync_comments" tools/resolve/README.md` → match
- [ ] `grep -rnE "import requests|from requests" tools/resolve` → no matches (stdlib-only)
- [ ] Only files under `tools/resolve/` were added/modified (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `tools/resolve/freeframe_review.py` does not exist or lacks `fetch_comments` / `load_link`
  (Plan 006 has not landed — do it first).
- `GET /share/{token}/comments` no longer returns a list of objects carrying `timecode_start`
  (seconds), `body`, `resolved`, and `author`/`guest_author` (the API contract drifted).
- The Resolve marker API differs from "Current state" (e.g. `AddMarker` arity changed,
  `DeleteMarkerByCustomData`/`GetMarkers` missing) — report the exact signature you found.
- A verification command fails twice after a reasonable fix.
- You need to edit `apps/api/**` or `pip install` anything — the approach drifted; STOP.

## Maintenance notes

- **Frame math hinges on `mark_in_frame`** (stored by Plan 006). It is `0` for whole-timeline pushes.
  If Plan 006 ever gains in/out-range rendering, it MUST write the real MarkIn frame into the sidecar,
  or every marker here lands offset by the in-point. This is the single most important invariant.
- **fps precision**: `timecode_start` is seconds; `round(seconds * fps)` can be ±1 frame for
  drop-frame rates (23.976/29.97). That's acceptable for review markers. If exactness is ever needed,
  store the comment's `frame_number` server-side and key the marker on that instead.
- **Idempotency** depends on the `freeframe:` `customData` prefix and `DeleteMarkerByCustomData`. Any
  marker an editor adds by hand (without that prefix) is never touched — by design.
- **Token discovery**: primary path is the sidecar written by Plan 006; secondary is a review
  URL/token passed as `sys.argv[1]` (handy from the console). A future nicety is a small Fusion
  UIManager input dialog so a token can be pasted from the menu — deferred to keep v1 dependency-free.
- Reviewer should scrutinise: only timecoded comments become markers (general comments are skipped);
  re-sync never duplicates; the read path uses no API key (the public share endpoint is token-only).
