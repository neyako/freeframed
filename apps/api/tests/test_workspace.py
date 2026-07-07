from apps.api.models.branding import WorkspaceSettings


def test_get_workspace_returns_defaults_when_no_row(client, mock_db):
    mock_db.first.return_value = None

    resp = client.get("/workspace")

    assert resp.status_code == 200
    assert resp.json() == {
        "name": "FreeFrame",
        "logo_dark": None,
        "logo_light": None,
    }
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()


def test_put_admin_workspace_rejects_non_admin(client, auth_headers, mock_db):
    resp = client.put(
        "/admin/workspace",
        headers=auth_headers,
        json={"name": "Studio"},
    )

    assert resp.status_code == 403
    mock_db.commit.assert_not_called()


def test_put_admin_workspace_updates_name(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    workspace = WorkspaceSettings(id=1, name="FreeFrame")
    mock_db.first.return_value = workspace

    resp = client.put(
        "/admin/workspace",
        headers=auth_headers,
        json={"name": "  Studio  "},
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Studio"
    assert workspace.name == "Studio"
    mock_db.commit.assert_called_once()


def test_put_admin_workspace_rejects_non_image_logo(client, auth_headers, test_user):
    test_user.is_superadmin = True

    resp = client.put(
        "/admin/workspace",
        headers=auth_headers,
        json={"logo_dark": "https://example.com/logo.png"},
    )

    assert resp.status_code == 422


def test_storage_stats_requires_auth(client):
    resp = client.get("/workspace/storage")

    assert resp.status_code in (401, 403)


def test_storage_stats_returns_usage_and_disk(client, auth_headers, mock_db):
    from collections import namedtuple
    from unittest.mock import patch

    mock_db.join.return_value = mock_db
    mock_db.scalar.return_value = 1_400_000_000

    Usage = namedtuple("usage", ["total", "used", "free"])
    with patch("apps.api.routers.workspace.shutil.disk_usage", return_value=Usage(4_000_000_000_000, 1_500_000_000, 3_998_500_000_000)):
        resp = client.get("/workspace/storage", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "used_bytes": 1_400_000_000,
        "disk_total_bytes": 4_000_000_000_000,
        "disk_free_bytes": 3_998_500_000_000,
    }


def test_storage_stats_survives_missing_disk_path(client, auth_headers, mock_db):
    from unittest.mock import patch

    mock_db.join.return_value = mock_db
    mock_db.scalar.return_value = 0

    with patch("apps.api.routers.workspace.shutil.disk_usage", side_effect=FileNotFoundError):
        resp = client.get("/workspace/storage", headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json() == {"used_bytes": 0, "disk_total_bytes": None, "disk_free_bytes": None}
