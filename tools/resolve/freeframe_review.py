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
    """Any user-actionable failure in the bridge."""


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
    if not isinstance(cfg, dict):
        raise FreeFrameError("Config at %s is not a JSON object." % path)
    for key in ("api_url", "api_key", "project_id"):
        if not cfg.get(key):
            raise FreeFrameError("Config at %s is missing required key: %s" % (path, key))
    cfg["api_url"] = str(cfg["api_url"]).rstrip("/")
    return cfg


class _ChainedStream(io.RawIOBase):
    """Read-only stream: preamble bytes, then file contents, then epilogue."""

    def __init__(self, preamble: bytes, file_path: str, epilogue: bytes) -> None:
        self._parts = [io.BytesIO(preamble), open(file_path, "rb"), io.BytesIO(epilogue)]
        self._idx = 0

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        while self._idx < len(self._parts):
            n = self._parts[self._idx].readinto(b)
            if n:
                return n
            self._parts[self._idx].close()
            self._idx += 1
        return 0

    def close(self) -> None:
        for part in self._parts:
            part.close()
        super().close()


def _build_multipart(
    fields: Dict[str, str],
    file_field: str,
    file_path: str,
    file_name: str,
    file_ctype: str,
):
    boundary = uuid.uuid4().hex
    pre = io.BytesIO()
    for name, value in fields.items():
        pre.write(("--%s\r\n" % boundary).encode())
        pre.write(('Content-Disposition: form-data; name="%s"\r\n\r\n' % name).encode())
        pre.write(("%s\r\n" % value).encode())
    pre.write(("--%s\r\n" % boundary).encode())
    pre.write(
        (
            'Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
            % (file_field, file_name)
        ).encode()
    )
    pre.write(("Content-Type: %s\r\n\r\n" % file_ctype).encode())
    preamble = pre.getvalue()
    epilogue = ("\r\n--%s--\r\n" % boundary).encode()
    length = len(preamble) + os.path.getsize(file_path) + len(epilogue)
    headers = {
        "Content-Type": "multipart/form-data; boundary=%s" % boundary,
        "Content-Length": str(length),
    }
    return headers, _ChainedStream(preamble, file_path, epilogue)


def push_review(
    cfg: Dict[str, Any],
    file_path: str,
    asset_name: str,
    mime_type: str,
    permission: str = "comment",
    allow_download: bool = False,
    timeout: int = 3600,
) -> Dict[str, Any]:
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
    headers, body = _build_multipart(
        fields,
        "file",
        file_path,
        os.path.basename(file_path),
        mime_type,
    )
    headers["X-Api-Key"] = str(cfg["api_key"])
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise FreeFrameError("review-ingest failed: HTTP %s %s" % (exc.code, detail)) from exc
    except urllib.error.URLError as exc:
        raise FreeFrameError("Could not reach FreeFrame at %s: %s" % (url, exc.reason)) from exc
    finally:
        body.close()


def fetch_comments(
    cfg: Dict[str, Any],
    token: str,
    timeout: int = 60,
) -> List[Dict[str, Any]]:
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


def save_link(timeline_key: str, data: Dict[str, Any]) -> None:
    LINKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    store: Dict[str, Any] = {}
    if LINKS_PATH.exists():
        try:
            existing = json.loads(LINKS_PATH.read_text())
        except json.JSONDecodeError:
            existing = {}
        if isinstance(existing, dict):
            store = existing
    store[timeline_key] = data
    LINKS_PATH.write_text(json.dumps(store, indent=2))
    try:
        LINKS_PATH.chmod(0o600)
    except OSError as exc:
        raise FreeFrameError("Could not restrict permissions on %s: %s" % (LINKS_PATH, exc)) from exc


def load_link(timeline_key: str) -> Optional[Dict[str, Any]]:
    if not LINKS_PATH.exists():
        return None
    try:
        store = json.loads(LINKS_PATH.read_text())
    except json.JSONDecodeError:
        return None
    if not isinstance(store, dict):
        return None
    value = store.get(timeline_key)
    if not isinstance(value, dict):
        return None
    return value


_RESOLVED_COLOR = "Green"
_OPEN_COLOR = "Yellow"
_CUSTOM_PREFIX = "freeframe:"


def _author_name(comment: Dict[str, Any]) -> str:
    src = comment.get("author") or comment.get("guest_author") or {}
    return (src.get("name") or "Reviewer").strip() or "Reviewer"


def flatten_comments(comments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep top-level comments anchored to a timecode for marker creation."""
    return [comment for comment in comments if comment.get("timecode_start") is not None]


def comment_to_marker(
    comment: Dict[str, Any],
    fps: float,
    mark_in_frame: int = 0,
) -> Dict[str, Any]:
    """Map one FreeFrame comment to Resolve AddMarker arguments."""
    seconds = float(comment["timecode_start"])
    frame_id = int(mark_in_frame) + int(round(seconds * float(fps)))
    if frame_id < 0:
        frame_id = 0
    color = _RESOLVED_COLOR if comment.get("resolved") else _OPEN_COLOR
    author = _author_name(comment)
    body = (comment.get("body") or "").strip()
    note_lines = ["%s: %s" % (author, body)]
    for reply in comment.get("replies") or []:
        note_lines.append("  > %s: %s" % (_author_name(reply), (reply.get("body") or "").strip()))
    note = "\n".join(note_lines)
    first_line = (body.splitlines() or ["Comment"])[0]
    name = first_line[:40] or "Comment"
    return {
        "frameId": frame_id,
        "color": color,
        "name": name,
        "note": note,
        "customData": "%s%s" % (_CUSTOM_PREFIX, comment.get("id", "")),
    }
