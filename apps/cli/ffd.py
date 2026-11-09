#!/usr/bin/env python3
"""ffd: let an AI agent upload cuts to freeframed and babysit their review.

Standard library only, so any agent with a shell can run it:

    ffd login --url http://nas:8080 --token ffd_...   # once
    ffd guide                     # how to run the review loop (skill text)
    ffd upload cut.mp4 --project <id> --note "v1: B-roll, SFX, music pass"
    ffd wait <asset>              # blocks until approved or changes requested
    ffd reply <asset> <comment> "Done: swapped the B-roll" --resolve
    ffd upload cut_v2.mp4 --asset <asset> --note "v2: ..."

Config: ~/.config/ffd/config.json (from `ffd login`), overridden by FFD_URL,
FFD_TOKEN and FFD_API_URL (defaults to $FFD_URL/api, the all-in-one layout).
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ffd" / "config.json"
CHUNK_BYTES = 10 * 1024 * 1024  # matches the web uploader
EXIT_TIMEOUT = 3  # `wait` gave up; nothing decided yet, run it again
EXIT_FAILED = 2  # the version failed to process

# Containers mimetypes doesn't know everywhere
_MIME_FALLBACK = {".mov": "video/quicktime", ".mkv": "video/x-matroska", ".m4a": "audio/x-m4a"}


class FfdError(Exception):
    pass


# ── Config + HTTP ──────────────────────────────────────────────────────────────

def load_config() -> dict:
    cfg = {}
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text())
    url = os.environ.get("FFD_URL") or cfg.get("url")
    token = os.environ.get("FFD_TOKEN") or cfg.get("token")
    if not url or not token:
        raise FfdError("Not configured. Run: ffd login --url <freeframed url> --token <agent token>")
    url = url.rstrip("/")
    api = (os.environ.get("FFD_API_URL") or cfg.get("api_url") or f"{url}/api").rstrip("/")
    return {"url": url, "api": api, "token": token}


class Client:
    def __init__(self, cfg: dict):
        self.cfg = cfg

    def request(self, method: str, path: str, body=None, query: dict | None = None):
        url = self.cfg["api"] + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.cfg['token']}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except (ValueError, AttributeError):
                pass
            raise FfdError(f"{method} {path} -> {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            raise FfdError(f"Can't reach {self.cfg['api']}: {e.reason}") from None
        return json.loads(raw) if raw else None

    def get(self, path, **query):
        return self.request("GET", path, query=query)

    def post(self, path, body=None, **query):
        return self.request("POST", path, body=body, query=query)

    def review_url(self, asset: dict) -> str:
        return f"{self.cfg['url']}/projects/{asset['project_id']}/assets/{asset['id']}"


# ── Formatting ─────────────────────────────────────────────────────────────────

def fmt_time(seconds: float, fps: float | None) -> str:
    """0:12.17 (f365): readable plus an exact frame for the NLE."""
    m, s = divmod(seconds, 60)
    out = f"{int(m)}:{s:05.2f}"
    if fps:
        out += f" (f{round(seconds * fps)})"
    return out


def fmt_range(c: dict, fps: float | None) -> str:
    start, end = c.get("timecode_start"), c.get("timecode_end")
    if start is None:
        return "whole video"
    if end is None or end <= start:
        return fmt_time(start, fps)
    return f"{fmt_time(start, fps)} to {fmt_time(end, fps)}, {end - start:.2f}s"


def author_name(c: dict) -> str:
    a = c.get("author") or c.get("guest_author") or {}
    name = a.get("name") or "Unknown"
    return f"{name} (agent)" if a.get("is_agent") else name


def human_decision(approvals: list[dict]) -> dict | None:
    """Latest approve/reject by a person; agents can't decide."""
    decided = [
        a for a in approvals
        if a["status"] in ("approved", "rejected") and not (a.get("user") or {}).get("is_agent")
    ]
    return max(decided, key=lambda a: a["created_at"]) if decided else None


def render_feedback(asset: dict, version: dict, comments: list[dict], decision: dict | None,
                    review_url: str, images: dict[str, list[str]]) -> str:
    """Markdown brief for the agent: what to change, where, and why."""
    media = (version.get("files") or [{}])[0]
    fps = media.get("fps")
    if decision is None:
        state = "waiting for review"
    else:
        who = (decision.get("user") or {}).get("name") or "reviewer"
        verb = "APPROVED" if decision["status"] == "approved" else "CHANGES REQUESTED"
        state = f"{verb} by {who}"

    lines = [f"# {asset['name']} v{version['version_number']}: {state}", "", f"Review: {review_url}"]
    facts = []
    if media.get("duration_seconds"):
        facts.append(f"duration {fmt_time(media['duration_seconds'], None)}")
    if fps:
        facts.append(f"{fps:g} fps")
    if asset.get("target_duration_seconds"):
        facts.append(f"target {asset['target_duration_seconds']}s")
    if facts:
        lines.append(", ".join(facts).capitalize())
    if decision and decision.get("note"):
        lines += ["", "Reviewer note:", f"> {decision['note']}"]

    def ordered(cs):
        return sorted(cs, key=lambda c: (c.get("timecode_start") is None, c.get("timecode_start") or 0))

    def block(c: dict, n: int) -> list[str]:
        tag = "CUT " if c.get("is_cut") else ""
        out = [f"{n}. {tag}[{fmt_range(c, fps)}] {author_name(c)}  id={c['id']}"]
        out += [f"   {line}" for line in c["body"].splitlines() or ["(drawing only)"]]
        out += [f"   image: {p}" for p in images.get(c["id"], [])]
        for r in c.get("replies") or []:
            out.append(f"   reply from {author_name(r)}: {r['body']}")
            out += [f"     image: {p}" for p in images.get(r["id"], [])]
        return out

    def by_agent(c):
        return bool((c.get("author") or {}).get("is_agent"))

    mine = ordered(c for c in comments if by_agent(c))
    open_ = ordered(c for c in comments if not c["resolved"] and not by_agent(c))
    done = ordered(c for c in comments if c["resolved"] and not by_agent(c))
    cuts = [c for c in open_ if c.get("is_cut")]
    lines += ["", f"## Open ({len(open_)})"]
    if cuts:
        removed = sum(c["timecode_end"] - c["timecode_start"] for c in cuts)
        lines.append(f"{len(cuts)} CUT range(s) remove {removed:.2f}s: take those frames out of the edit.")
    if not open_:
        lines.append("Nothing open.")
    for n, c in enumerate(open_, 1):
        lines += block(c, n)
    if done:
        lines += ["", f"## Resolved ({len(done)})"]
        for n, c in enumerate(done, 1):
            lines += block(c, n)
    if mine:
        lines += ["", f"## Your notes ({len(mine)}), read replies to them as feedback too"]
        for n, c in enumerate(mine, 1):
            lines += block(c, n)
    return "\n".join(lines) + "\n"


# ── Feedback gathering ─────────────────────────────────────────────────────────

def latest_version(client: Client, asset_id: str) -> dict:
    versions = client.get(f"/assets/{asset_id}/versions")
    if not versions:
        raise FfdError("Asset has no versions")
    return versions[0]  # newest first


def pick_version(client: Client, asset_id: str, number: int | None) -> dict:
    if number is None:
        return latest_version(client, asset_id)
    for v in client.get(f"/assets/{asset_id}/versions"):
        if v["version_number"] == number:
            return v
    raise FfdError(f"No version {number}")


def download_images(comments: list[dict], out_dir: Path) -> dict[str, list[str]]:
    """Drawing snapshots and image attachments, saved next to the brief."""
    found: dict[str, list[str]] = {}

    def visit(c: dict):
        urls = []
        snap = (c.get("annotation") or {}).get("snapshot_url")
        if snap:
            urls.append((f"{c['id'][:8]}-drawing.jpg", snap))
        for a in c.get("attachments") or []:
            if a["content_type"].startswith("image/"):
                urls.append((f"{c['id'][:8]}-{a['file_name']}", a["url"]))
            else:
                found.setdefault(c["id"], []).append(f"{a['file_name']} ({a['content_type']}) {a['url']}")
        for name, url in urls:
            out_dir.mkdir(parents=True, exist_ok=True)
            path = out_dir / name
            urllib.request.urlretrieve(url, path)
            found.setdefault(c["id"], []).append(str(path))
        for r in c.get("replies") or []:
            visit(r)

    for c in comments:
        visit(c)
    return found


def gather(client: Client, asset_id: str, version: dict, out: Path | None):
    asset = client.get(f"/assets/{asset_id}")
    comments = client.get(f"/assets/{asset_id}/comments", version_id=version["id"])
    approvals = client.get(f"/assets/{asset_id}/approvals", version_id=version["id"])
    out_dir = out or Path("freeframed-feedback") / f"{asset_id[:8]}-v{version['version_number']}"
    images = download_images(comments, out_dir)
    decision = human_decision(approvals)
    md = render_feedback(asset, version, comments, decision, client.review_url(asset), images)
    return md, decision, {"asset": asset, "version": version, "comments": comments, "approvals": approvals}


# ── Commands ───────────────────────────────────────────────────────────────────

def cmd_login(args):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    cfg = {"url": args.url.rstrip("/"), "token": args.token}
    if args.api_url:
        cfg["api_url"] = args.api_url.rstrip("/")
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    CONFIG_PATH.chmod(0o600)
    projects = Client(load_config()).get("/projects")
    print(f"Logged in. {len(projects)} project(s) visible. Config: {CONFIG_PATH}")


def cmd_guide(args):
    """Print the review-loop guide served by this freeframed (the skill text)."""
    cfg = load_config()
    req = urllib.request.Request(cfg["api"] + "/cli/guide")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(resp.read().decode())
    except urllib.error.URLError as e:
        raise FfdError(f"Can't fetch the guide from {cfg['api']}: {e}") from None


def cmd_projects(args):
    for p in Client(load_config()).get("/projects"):
        print(f"{p['id']}  {p['name']}")


def guess_mime(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or _MIME_FALLBACK.get(path.suffix.lower())
    if not mime:
        raise FfdError(f"Unknown file type: {path.name}")
    return mime


def cmd_upload(args):
    client = Client(load_config())
    path = Path(args.file)
    size = path.stat().st_size
    body = {
        "asset_name": args.name or path.stem,
        "original_filename": path.name,
        "mime_type": guess_mime(path),
        "file_size_bytes": size,
    }
    if args.asset:
        asset = client.get(f"/assets/{args.asset}")
        init = client.post(f"/assets/{args.asset}/versions", {**body, "project_id": asset["project_id"]})
    else:
        if not args.project:
            raise FfdError("Pass --asset <id> for a new version or --project <id> for a new asset")
        init = client.post("/upload/initiate", {**body, "project_id": args.project, "folder_id": args.folder})

    ids = {k: init[k] for k in ("s3_key", "upload_id", "asset_id", "version_id")}
    parts = []
    try:
        with path.open("rb") as f:
            n = 0
            while chunk := f.read(CHUNK_BYTES):
                n += 1
                url = client.post("/upload/presign-part", {
                    "s3_key": ids["s3_key"], "upload_id": ids["upload_id"], "part_number": n,
                })["presigned_url"]
                req = urllib.request.Request(url, data=chunk, method="PUT",
                                             headers={"Content-Type": "application/octet-stream"})
                with urllib.request.urlopen(req, timeout=300) as resp:
                    parts.append({"PartNumber": n, "ETag": resp.headers["ETag"]})
                print(f"\rUploading {min(n * CHUNK_BYTES, size) / size:6.1%}", end="", file=sys.stderr)
        print(file=sys.stderr)
        client.post("/upload/complete", {**ids, "parts": parts})
    except BaseException:
        try:
            client.post("/upload/abort", ids)
        except FfdError:
            pass
        raise

    asset = client.get(f"/assets/{ids['asset_id']}")
    version = next(v for v in client.get(f"/assets/{ids['asset_id']}/versions") if v["id"] == ids["version_id"])
    if args.note:
        client.post(f"/assets/{asset['id']}/comments", {"version_id": version["id"], "body": args.note})
    print(json.dumps({
        "asset_id": asset["id"],
        "version": version["version_number"],
        "version_id": version["id"],
        "review_url": client.review_url(asset),
    }, indent=2))


def cmd_feedback(args):
    client = Client(load_config())
    version = pick_version(client, args.asset, args.version)
    md, _, raw = gather(client, args.asset, version, Path(args.out) if args.out else None)
    print(json.dumps(raw, indent=2) if args.json else md.rstrip("\n"))


def cmd_wait(args):
    """Block until a person approves or requests changes on the newest version."""
    client = Client(load_config())
    deadline = time.monotonic() + args.timeout if args.timeout else None
    while True:
        version = latest_version(client, args.asset)
        if version["processing_status"] == "failed":
            print(f"v{version['version_number']} failed to process. Re-export and upload again.")
            return EXIT_FAILED
        approvals = client.get(f"/assets/{args.asset}/approvals", version_id=version["id"])
        if human_decision(approvals):
            md, _, _ = gather(client, args.asset, version, Path(args.out) if args.out else None)
            print(md.rstrip("\n"))
            return 0
        if deadline and time.monotonic() >= deadline:
            print(f"Still waiting on v{version['version_number']}. Run `ffd wait {args.asset}` again.")
            return EXIT_TIMEOUT
        time.sleep(args.interval)


def cmd_status(args):
    client = Client(load_config())
    version = latest_version(client, args.asset)
    decision = human_decision(client.get(f"/assets/{args.asset}/approvals", version_id=version["id"]))
    state = "waiting for review" if not decision else (
        "approved" if decision["status"] == "approved" else "changes requested")
    print(f"v{version['version_number']} {version['processing_status']}, {state}")


def find_comment(comments: list[dict], comment_id: str) -> dict | None:
    for c in comments:
        if c["id"] == comment_id:
            return c
        hit = find_comment(c.get("replies") or [], comment_id)
        if hit:
            return hit
    return None


def cmd_reply(args):
    client = Client(load_config())
    target = find_comment(client.get(f"/assets/{args.asset}/comments"), args.comment)
    if not target:
        raise FfdError(f"No comment {args.comment} on asset {args.asset}")
    client.post(f"/assets/{args.asset}/comments/{args.comment}/replies",
                {"version_id": target["version_id"], "body": args.text})
    if args.resolve:
        client.post(f"/comments/{args.comment}/resolve", resolved="true")
    print("Replied" + (" and resolved" if args.resolve else ""))


def cmd_resolve(args):
    Client(load_config()).post(f"/comments/{args.comment}/resolve", resolved="false" if args.reopen else "true")
    print("Reopened" if args.reopen else "Resolved")


def cmd_comment(args):
    """Post a note on a version, e.g. a question about a specific moment."""
    client = Client(load_config())
    version = pick_version(client, args.asset, args.version)
    body = {"version_id": version["id"], "body": args.text, "timecode_start": args.at, "timecode_end": args.to}
    c = client.post(f"/assets/{args.asset}/comments", body)
    print(c["id"])


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="ffd", description="freeframed for agents: upload cuts, read feedback, wait for approval.")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("login", help="save the freeframed URL and agent token")
    s.add_argument("--url", required=True, help="freeframed web URL, e.g. http://192.168.1.10:3000")
    s.add_argument("--token", required=True, help="agent token from Settings > Agents")
    s.add_argument("--api-url", help="API URL when it isn't <url>/api (dev setups)")
    s.set_defaults(fn=cmd_login)

    s = sub.add_parser("guide", help="print the review-loop guide; save it as a skill")
    s.set_defaults(fn=cmd_guide)

    s = sub.add_parser("projects", help="list projects (id, name)")
    s.set_defaults(fn=cmd_projects)

    s = sub.add_parser("upload", help="upload a file as a new asset or a new version")
    s.add_argument("file")
    s.add_argument("--asset", help="upload as the next version of this asset")
    s.add_argument("--project", help="new asset in this project")
    s.add_argument("--folder", help="new asset in this folder")
    s.add_argument("--name", help="asset name (default: file name)")
    s.add_argument("--note", help="what changed; posted as the version's first comment")
    s.set_defaults(fn=cmd_upload)

    s = sub.add_parser("status", help="one line: newest version, processing, decision")
    s.add_argument("asset")
    s.set_defaults(fn=cmd_status)

    for name, fn, help_ in (
        ("feedback", cmd_feedback, "print the review brief for a version now"),
        ("wait", cmd_wait, "block until the newest version is approved or changes are requested"),
    ):
        s = sub.add_parser(name, help=help_)
        s.add_argument("asset")
        s.add_argument("--out", help="where to save drawing snapshots and image attachments")
        if name == "feedback":
            s.add_argument("--version", type=int, help="version number (default: newest)")
            s.add_argument("--json", action="store_true", help="raw API data instead of markdown")
        else:
            s.add_argument("--interval", type=int, default=20, help="seconds between checks")
            s.add_argument("--timeout", type=int, help=f"give up after N seconds (exit {EXIT_TIMEOUT})")
        s.set_defaults(fn=fn)

    s = sub.add_parser("reply", help="reply to a comment, optionally resolving it")
    s.add_argument("asset")
    s.add_argument("comment")
    s.add_argument("text")
    s.add_argument("--resolve", action="store_true")
    s.set_defaults(fn=cmd_reply)

    s = sub.add_parser("resolve", help="mark a comment resolved")
    s.add_argument("comment")
    s.add_argument("--reopen", action="store_true")
    s.set_defaults(fn=cmd_resolve)

    s = sub.add_parser("comment", help="post a note on a version, optionally at a time range")
    s.add_argument("asset")
    s.add_argument("text")
    s.add_argument("--at", type=float, help="start, seconds")
    s.add_argument("--to", type=float, help="end, seconds")
    s.add_argument("--version", type=int, help="version number (default: newest)")
    s.set_defaults(fn=cmd_comment)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args) or 0
    except FfdError as e:
        print(f"ffd: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
