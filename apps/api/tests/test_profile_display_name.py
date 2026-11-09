"""A profile update trims the display name and refuses a blank one."""
import pytest


@pytest.mark.parametrize("name", ["", "   ", "\n\t"])
def test_blank_display_name_is_refused(client, auth_headers, mock_db, test_user, name):
    mock_db.first.return_value = test_user
    before = test_user.name

    resp = client.patch(f"/users/{test_user.id}", json={"name": name}, headers=auth_headers)

    assert resp.status_code == 422
    assert test_user.name == before
    mock_db.commit.assert_not_called()


def test_display_name_is_trimmed(client, auth_headers, mock_db, test_user):
    mock_db.first.return_value = test_user

    resp = client.patch(f"/users/{test_user.id}", json={"name": "  Neyako  "}, headers=auth_headers)

    assert resp.status_code == 200
    assert test_user.name == "Neyako"
