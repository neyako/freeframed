#!/usr/bin/env python3
from __future__ import annotations

import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ff = importlib.import_module("freeframe_review")


def _connect_resolve():
    resolve_app = globals().get("resolve")
    if resolve_app is not None:
        return resolve_app
    try:
        dvr_script = importlib.import_module("DaVinciResolveScript")
    except ImportError as exc:
        raise ff.FreeFrameError(
            "Could not connect to DaVinci Resolve. Run this from Resolve's "
            "Workspace > Scripts > Utility menu. (%s)" % exc
        ) from exc
    return dvr_script.scriptapp("Resolve")


def _resolve_token(timeline_key, timeline_name):
    link = ff.load_link(timeline_key) or ff.load_link(timeline_name)
    if link and link.get("token"):
        return link.get("token"), link
    if len(sys.argv) > 1 and sys.argv[1].strip():
        arg = sys.argv[1].strip()
        token = arg.rsplit("/share/", 1)[-1].strip("/") if "/share/" in arg else arg
        return token, {"token": token}
    raise ff.FreeFrameError(
        "No review link found for this timeline. Run 'FreeFrame: Push for Review' "
        "on it first, or pass the review URL/token as an argument."
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
        timeline_key = timeline.GetUniqueId() or timeline_name
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

    existing = timeline.GetMarkers() or {}
    for info in existing.values():
        custom_data = (info or {}).get("customData") or ""
        if custom_data.startswith("freeframe:"):
            timeline.DeleteMarkerByCustomData(custom_data)

    placed = 0
    max_nudge = max(1, int(round(fps)))
    for comment in anchored:
        marker = ff.comment_to_marker(comment, fps, mark_in_frame)
        frame = marker["frameId"]
        added = False
        for offset in range(max_nudge):
            if timeline.AddMarker(
                frame + offset,
                marker["color"],
                marker["name"],
                marker["note"],
                1,
                marker["customData"],
            ):
                added = True
                break
        if added:
            placed += 1
        else:
            print("  (skipped a comment near frame %d; could not place a marker)" % frame)

    print("")
    print("Placed %d FreeFrame marker(s) on '%s'." % (placed, timeline_name))
    print("Green = resolved, Yellow = open.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ff.FreeFrameError as exc:
        print("")
        print("FreeFrame sync failed: %s" % exc)
        sys.exit(1)
