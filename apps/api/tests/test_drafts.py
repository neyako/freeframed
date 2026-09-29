"""Draft-named uploads ("draft 3 - X") are versions of X, not new assets."""
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from apps.api.models.asset import AssetType
from apps.api.services.drafts import plan_draft_merges, split_draft_name


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("draft 3 - mang den cho ban", (3, "mang den cho ban")),
        ("Draft1_Intro", (1, "Intro")),
        ("DRAFT 12 – Intro cut", (12, "Intro cut")),
        ("draft 2 Intro", (2, "Intro")),
        ("Drafts for client", None),
        ("draft 3", None),
        ("Intro - draft 3", None),
    ],
)
def test_split_draft_name(name, expected):
    assert split_draft_name(name) == expected


def _asset(name, minutes=0, folder_id=None):
    return SimpleNamespace(
        id=uuid.uuid4(), name=name, project_id="p1", folder_id=folder_id, asset_type=AssetType.video,
        created_at=datetime(2026, 9, 1, tzinfo=timezone.utc) + timedelta(minutes=minutes),
    )


def test_plan_folds_later_drafts_into_the_first_in_draft_order():
    draft3 = _asset("draft 3 - Intro", minutes=1)
    draft1 = _asset("draft 1 - Intro", minutes=2)
    draft2 = _asset("Draft 2 - intro", minutes=3)

    assert plan_draft_merges([draft3, draft1, draft2]) == [(draft1, [draft2, draft3], "Intro")]


def test_plan_keeps_an_undrafted_original_as_the_target():
    original = _asset("Intro", minutes=5)
    draft2 = _asset("draft 2 - Intro")

    assert plan_draft_merges([draft2, original]) == [(original, [draft2], "Intro")]


def test_plan_groups_per_folder_and_renames_lone_drafts():
    here = _asset("draft 1 - Intro")
    elsewhere = _asset("draft 2 - Intro", folder_id="f1")

    plans = plan_draft_merges([here, elsewhere])

    assert (here, [], "Intro") in plans
    assert (elsewhere, [], "Intro") in plans


def test_plan_skips_groups_without_drafts():
    assert plan_draft_merges([_asset("Intro"), _asset("Intro", minutes=1)]) == []
