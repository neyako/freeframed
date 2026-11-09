"""Email addresses match regardless of case, without ever guessing between two accounts."""
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from apps.api.routers import users
from apps.api.schemas.auth import InviteRequest
from apps.api.services.auth_service import get_email_owner, get_user_by_email


def test_a_differently_cased_address_finds_the_account(db, make_user):
    bob = make_user("bob@example.com")

    assert get_user_by_email(db, "Bob@Example.com") is bob
    assert get_user_by_email(db, "  bob@example.com ") is bob
    assert get_user_by_email(db, "nobody@example.com") is None


def test_two_accounts_differing_only_by_case_each_answer_to_their_exact_address(db, make_user):
    lower = make_user("sam@example.com")
    upper = make_user("Sam@example.com")

    assert get_user_by_email(db, "sam@example.com") is lower
    assert get_user_by_email(db, "Sam@example.com") is upper
    # a third spelling could be either, so it opens neither
    assert get_user_by_email(db, "SAM@example.com") is None


def test_a_deleted_account_still_owns_its_address_but_a_live_one_is_preferred(db, make_user):
    gone = make_user("ann@example.com")
    gone.deleted_at = datetime.now(timezone.utc)
    db.flush()

    assert get_user_by_email(db, "ann@example.com") is None  # cannot sign in
    assert get_email_owner(db, "ANN@example.com") is gone  # but the address is taken

    live = make_user("ANN@Example.com")
    assert get_email_owner(db, "ann@example.com") is live


def test_inviting_an_address_that_differs_only_by_case_is_refused(db, make_user):
    admin = make_user("owner@example.com")
    admin.is_superadmin = True
    make_user("bob@example.com")
    db.flush()

    with patch.object(users, "send_task_safe"), patch.object(users, "get_workspace_name", return_value="ws"):
        with pytest.raises(HTTPException) as caught:
            users.invite_user(InviteRequest(email="Bob@Example.com", name="Bob"), db, admin)

    assert caught.value.status_code == 400


def test_a_new_account_is_stored_lowercase():
    assert InviteRequest(email="New.Person@Example.COM", name="N").email == "new.person@example.com"
