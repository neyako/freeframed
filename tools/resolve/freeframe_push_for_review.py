#!/usr/bin/env python3
from __future__ import annotations

import datetime
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freeframe_review as ff  # noqa: E402


def _connect_resolve():
    injected_resolve = globals().get("resolve")
    if injected_resolve is not None:
        return injected_resolve

    try:
        import DaVinciResolveScript as dvr_script
        return dvr_script.scriptapp("Resolve")
    except Exception as exc:
        raise ff.FreeFrameError(
            "Could not connect to DaVinci Resolve. Run this from Resolve's "
            "Workspace > Scripts > Utility menu. (%s)" % exc
        ) from exc


def _timeline_key(timeline, timeline_name: str) -> str:
    try:
        return timeline.GetUniqueId()
    except Exception:
        return timeline_name


def _timeline_fps(project, timeline) -> float:
    try:
        return float(timeline.GetSetting("timelineFrameRate"))
    except Exception:
        return float(project.GetSetting("timelineFrameRate"))


def _render_current_timeline(project, timeline_name: str, tempdir: str) -> str:
    custom_name = "freeframe_review_%d" % int(time.time())

    if not project.SetCurrentRenderFormatAndCodec("mp4", "H264"):
        raise ff.FreeFrameError("Resolve rejected the mp4/H264 render format/codec.")
    if not project.SetRenderSettings(
        {
            "SelectAllFrames": True,
            "TargetDir": tempdir,
            "CustomName": custom_name,
        }
    ):
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
        raise ff.FreeFrameError(
            "Render did not complete (status=%s)." % status.get("JobStatus")
        )

    candidates = [
        os.path.join(tempdir, name)
        for name in os.listdir(tempdir)
        if os.path.isfile(os.path.join(tempdir, name))
        and os.path.getsize(os.path.join(tempdir, name)) > 0
    ]
    if not candidates:
        raise ff.FreeFrameError(
            "Render reported complete but no output file was found in %s." % tempdir
        )
    return max(candidates, key=os.path.getmtime)


def main() -> int:
    cfg = ff.load_config()
    resolve_app = _connect_resolve()
    project = resolve_app.GetProjectManager().GetCurrentProject()
    if project is None:
        raise ff.FreeFrameError("No project is open in DaVinci Resolve.")

    timeline = project.GetCurrentTimeline()
    if timeline is None:
        raise ff.FreeFrameError(
            "No timeline is open. Open the cut you want to send for review."
        )

    timeline_name = timeline.GetName()
    timeline_key = _timeline_key(timeline, timeline_name)
    fps = _timeline_fps(project, timeline)
    with tempfile.TemporaryDirectory(prefix="freeframe_") as tempdir:
        out_file = _render_current_timeline(project, timeline_name, tempdir)

        asset_name = "%s - %s" % (timeline_name, datetime.date.today().isoformat())
        print("Uploading %.1f MB to FreeFrame ..." % (os.path.getsize(out_file) / 1e6))
        result = ff.push_review(
            cfg,
            out_file,
            asset_name=asset_name,
            mime_type="video/mp4",
        )

        ff.save_link(
            timeline_key,
            {
                "token": result["token"],
                "url": result["url"],
                "asset_id": result.get("asset_id"),
                "fps": fps,
                "mark_in_frame": 0,
                "timeline_name": timeline_name,
            },
        )

    print("\nReview link: %s\n" % result["url"])
    print("Reviewers can comment on this exact cut. Run 'FreeFrame: Sync comments'")
    print("on this timeline later to pull their notes back in as markers.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ff.FreeFrameError as exc:
        print("\n%s\n" % exc)
        sys.exit(1)
