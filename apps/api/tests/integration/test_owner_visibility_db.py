"""The workspace owner sees every project, including editors' Quick Shares;
editors only see projects they belong to."""
from apps.api.models.asset import Asset, AssetType
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.routers import me, projects


def _quick_shares(db, user):
    project = Project(name="Quick Shares", created_by=user.id, is_quick_share=True)
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=ProjectRole.owner))
    return project


def _upload(db, project, user, name):
    asset = Asset(project_id=project.id, name=name, asset_type=AssetType.video, created_by=user.id)
    db.add(asset)
    db.flush()
    return asset


def test_owner_sees_editor_quick_shares_named_by_creator(db, make_user) -> None:
    owner = make_user(name="Neyako")
    owner.is_superadmin = True
    editor = make_user(name="Linh")
    _quick_shares(db, owner)
    editor_qs = _quick_shares(db, editor)
    _upload(db, editor_qs, editor, "draft 1.mov")
    db.commit()

    listed = {p.name: p.role for p in projects.list_projects(db, owner)}
    feed = [a.name for a in me.list_my_assets(None, None, 0, 20, db, owner)]
    opened = projects.get_project(editor_qs.id, db, owner)

    assert listed == {"Quick Shares": ProjectRole.owner, "Linh's quick shares": ProjectRole.owner}
    assert feed == ["draft 1.mov"]
    assert opened.name == "Linh's quick shares"


def test_editor_only_sees_own_projects_and_uploads_history_stays_own(db, make_user) -> None:
    owner = make_user(name="Neyako")
    owner.is_superadmin = True
    editor = make_user(name="Linh")
    owner_qs = _quick_shares(db, owner)
    _upload(db, owner_qs, owner, "owner only.mov")
    editor_qs = _quick_shares(db, editor)
    _upload(db, editor_qs, editor, "mine.mov")
    db.commit()

    assert [p.name for p in projects.list_projects(db, editor)] == ["Quick Shares"]
    assert [a.name for a in me.list_my_assets(None, None, 0, 20, db, editor)] == ["mine.mov"]
    assert [a.name for a in me.list_my_assets("owned", None, 0, 20, db, owner)] == ["owner only.mov"]
