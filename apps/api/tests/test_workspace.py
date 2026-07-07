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
