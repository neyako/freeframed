"""The ffd CLI's review brief: what an agent reads to revise a cut."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("ffd", Path(__file__).parents[2] / "cli" / "ffd.py")
ffd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ffd)

HUMAN = {"name": "Neyako", "is_agent": False}
AGENT = {"name": "Claude", "is_agent": True}


def _comment(id_, body, start=None, end=None, author=HUMAN, **kw):
    return {
        "id": id_, "body": body, "timecode_start": start, "timecode_end": end,
        "author": author, "resolved": False, "is_cut": False, "replies": [], **kw,
    }


def _approval(status, user, at="2026-11-08T10:00:00Z", note=None):
    return {"status": status, "user": user, "created_at": at, "note": note}


def test_only_people_decide():
    approvals = [
        _approval("rejected", HUMAN, at="2026-11-08T10:00:00Z"),
        _approval("approved", HUMAN, at="2026-11-08T11:00:00Z"),
        _approval("approved", AGENT, at="2026-11-08T12:00:00Z"),
    ]
    assert ffd.human_decision(approvals)["created_at"] == "2026-11-08T11:00:00Z"
    assert ffd.human_decision([_approval("approved", AGENT)]) is None


def test_times_carry_an_exact_frame():
    assert ffd.fmt_time(72.5, 30) == "1:12.50 (f2175)"
    assert ffd.fmt_time(3.2, None) == "0:03.20"


def test_brief_orders_by_time_and_separates_cuts_resolved_and_agent_notes():
    asset = {"name": "Hook", "target_duration_seconds": 60}
    version = {"version_number": 3, "files": [{"fps": 30, "duration_seconds": 64}]}
    comments = [
        _comment("late", "music too loud", 40),
        _comment("cut", "dead air", 10, 12.5, is_cut=True),
        _comment("old", "fixed already", 5, resolved=True),
        _comment("note", "v3: new B-roll", author=AGENT,
                 replies=[_comment("r", "also brighter", author=HUMAN)]),
    ]
    decision = _approval("rejected", HUMAN, note="Closer, tighten the intro")

    md = ffd.render_feedback(asset, version, comments, decision, "http://x/review",
                             {"late": ["/tmp/late-drawing.jpg"]})

    assert md.startswith("# Hook v3: CHANGES REQUESTED by Neyako")
    assert "> Closer, tighten the intro" in md
    open_section = md.split("## Open (2)")[1].split("## Resolved")[0]
    assert open_section.index("id=cut") < open_section.index("id=late")
    assert "1 CUT range(s) remove 2.50s" in open_section
    assert "image: /tmp/late-drawing.jpg" in open_section
    assert "id=old" in md.split("## Resolved (1)")[1]
    assert "reply from Neyako: also brighter" in md.split("## Your notes (1)")[1]
