import os
import sys
from pathlib import Path
from uuid import UUID

import psycopg2
import pytest
from alembic import command
from alembic.config import Config
from psycopg2 import errors
from psycopg2.extras import register_uuid
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import ProgrammingError


ROOT = Path(__file__).resolve().parents[4]
API_ROOT = ROOT / "apps/api"
DATABASE_URL = os.environ["TEST_DATABASE_URL"]
os.environ["DATABASE_URL"] = DATABASE_URL
sys.path.insert(0, str(API_ROOT))
register_uuid()

U_A, U_B, U_C, U_D, U_E = (UUID(int=value) for value in range(1, 6))
P_LEGACY, P_C, P_B_DELETED = (UUID(int=value) for value in range(101, 104))
F_A, F_A_CHILD, F_B, F_C = (UUID(int=value) for value in range(201, 205))
A_A, A_B, A_C = (UUID(int=value) for value in range(301, 304))
L_ASSET, L_FOLDER, L_ROOT, L_MIXED, L_EMPTY, L_SOFT = (
    UUID(int=value) for value in range(401, 407)
)


def _alembic() -> Config:
    return Config(str(API_ROOT / "alembic.ini"))


def _reset() -> None:
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
    command.upgrade(_alembic(), "dd44ee55ff66")


def _seed() -> None:
    values = {
        "u_a": U_A, "u_b": U_B, "u_c": U_C, "u_d": U_D, "u_e": U_E,
        "p_legacy": P_LEGACY, "p_c": P_C, "p_b_deleted": P_B_DELETED,
        "f_a": F_A, "f_a_child": F_A_CHILD, "f_b": F_B, "f_c": F_C,
        "a_a": A_A, "a_b": A_B, "a_c": A_C,
        "l_asset": L_ASSET, "l_folder": L_FOLDER, "l_root": L_ROOT,
        "l_mixed": L_MIXED, "l_empty": L_EMPTY, "l_soft": L_SOFT,
    }
    sql = """
    INSERT INTO users (id,email,name,status,email_verified,is_superadmin) VALUES
      (%(u_a)s,'state-a@invalid.test','A','active',true,false),
      (%(u_b)s,'state-b@invalid.test','B','active',true,false),
      (%(u_c)s,'state-c@invalid.test','C','deactivated',true,false),
      (%(u_d)s,'state-d@invalid.test','D','active',true,false),
      (%(u_e)s,'state-e@invalid.test','E','active',true,false);
    INSERT INTO projects (id,name,project_type,created_by,is_quick_share,deleted_at) VALUES
      (%(p_legacy)s,'Legacy Quick Share','personal',%(u_a)s,true,NULL),
      (%(p_c)s,'Existing C Quick Share','personal',%(u_c)s,true,NULL),
      (%(p_b_deleted)s,'Deleted B Quick Share','personal',%(u_b)s,true,CURRENT_TIMESTAMP);
    INSERT INTO project_members (id,project_id,user_id,role,deleted_at) VALUES
      ('00000000-0000-0000-0000-000000000501',%(p_legacy)s,%(u_a)s,'owner',NULL),
      ('00000000-0000-0000-0000-000000000502',%(p_legacy)s,%(u_c)s,'reviewer',CURRENT_TIMESTAMP),
      ('00000000-0000-0000-0000-000000000503',%(p_legacy)s,%(u_d)s,'viewer',NULL),
      ('00000000-0000-0000-0000-000000000504',%(p_c)s,%(u_c)s,'editor',NULL),
      ('00000000-0000-0000-0000-000000000505',%(p_c)s,%(u_b)s,'viewer',NULL);
    INSERT INTO folders (id,project_id,parent_id,name,created_by,deleted_at) VALUES
      (%(f_a)s,%(p_legacy)s,NULL,'A root',%(u_a)s,NULL),
      (%(f_a_child)s,%(p_legacy)s,%(f_a)s,'A child',%(u_a)s,NULL),
      (%(f_b)s,%(p_legacy)s,%(f_a)s,'B cross-parent',%(u_b)s,NULL),
      (%(f_c)s,%(p_legacy)s,NULL,'C deleted',%(u_c)s,CURRENT_TIMESTAMP);
    INSERT INTO assets (id,project_id,name,asset_type,status,folder_id,created_by,deleted_at) VALUES
      (%(a_a)s,%(p_legacy)s,'A asset','video','draft',%(f_a_child)s,%(u_a)s,NULL),
      (%(a_b)s,%(p_legacy)s,'B cross-folder','video','draft',%(f_a)s,%(u_b)s,NULL),
      (%(a_c)s,%(p_legacy)s,'C deleted','image','draft',%(f_c)s,%(u_c)s,CURRENT_TIMESTAMP);
    INSERT INTO share_links (id,asset_id,folder_id,project_id,token,created_by,permission,allow_download,deleted_at) VALUES
      (%(l_asset)s,%(a_b)s,NULL,NULL,'asset-scope',%(u_e)s,'view',false,NULL),
      (%(l_folder)s,NULL,%(f_b)s,NULL,'folder-scope',%(u_b)s,'view',false,NULL),
      (%(l_root)s,NULL,NULL,%(p_legacy)s,'root-one-owner',%(u_b)s,'view',false,NULL),
      (%(l_mixed)s,NULL,NULL,%(p_legacy)s,'root-mixed',%(u_a)s,'view',false,NULL),
      (%(l_empty)s,NULL,NULL,%(p_legacy)s,'root-empty',%(u_a)s,'view',false,NULL),
      (%(l_soft)s,%(a_c)s,NULL,NULL,'soft-link',%(u_c)s,'view',false,CURRENT_TIMESTAMP);
    INSERT INTO share_link_items (id,share_link_id,asset_id,folder_id) VALUES
      ('00000000-0000-0000-0000-000000000601',%(l_root)s,%(a_b)s,NULL),
      ('00000000-0000-0000-0000-000000000602',%(l_root)s,NULL,%(f_b)s),
      ('00000000-0000-0000-0000-000000000603',%(l_mixed)s,%(a_a)s,NULL),
      ('00000000-0000-0000-0000-000000000604',%(l_mixed)s,%(a_b)s,NULL);
    INSERT INTO activity_logs (id,project_id,asset_id,user_id,action,payload) VALUES
      ('00000000-0000-0000-0000-000000000701',%(p_legacy)s,%(a_b)s,%(u_a)s,'created','{}'),
      ('00000000-0000-0000-0000-000000000702',%(p_legacy)s,NULL,%(u_c)s,'shared','{}'),
      ('00000000-0000-0000-0000-000000000703',%(p_legacy)s,NULL,%(u_d)s,'shared','{}'),
      ('00000000-0000-0000-0000-000000000704',%(p_legacy)s,%(a_a)s,%(u_b)s,'created','{}');
    """
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute(sql, values)


def _targets(cursor) -> dict[UUID, UUID]:
    cursor.execute(
        "SELECT created_by,id FROM projects WHERE is_quick_share IS TRUE AND deleted_at IS NULL"
    )
    return dict(cursor.fetchall())


def test_migration_isolates_objects_and_memberships_when_legacy_state_is_mixed() -> None:
    # Given
    _reset()
    _seed()

    # When
    command.upgrade(_alembic(), "ee55ff66aa77")

    # Then
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        targets = _targets(cursor)
        assert set(targets) == {U_A, U_B, U_C, U_D, U_E}
        assert targets[U_A] == P_LEGACY
        assert targets[U_C] == P_C
        assert targets[U_B] != P_B_DELETED
        cursor.execute(
            "SELECT user_id,role,deleted_at FROM project_members "
            "WHERE (project_id,user_id) IN %s",
            (tuple((project_id, user_id) for user_id, project_id in targets.items()),),
        )
        assert {(row[0], row[1]) for row in cursor if row[2] is None} == {
            (user_id, "owner") for user_id in targets
        }
        cursor.execute("SELECT project_id,parent_id,deleted_at FROM folders WHERE id=%s", (F_A_CHILD,))
        assert cursor.fetchone() == (targets[U_A], F_A, None)
        cursor.execute("SELECT project_id,parent_id FROM folders WHERE id=%s", (F_B,))
        assert cursor.fetchone() == (targets[U_B], None)
        cursor.execute("SELECT project_id,deleted_at FROM folders WHERE id=%s", (F_C,))
        project_id, deleted_at = cursor.fetchone()
        assert (project_id, deleted_at is not None) == (targets[U_C], True)
        cursor.execute("SELECT project_id,folder_id FROM assets WHERE id=%s", (A_B,))
        assert cursor.fetchone() == (targets[U_B], None)
        cursor.execute("SELECT project_id,folder_id,deleted_at FROM assets WHERE id=%s", (A_C,))
        project_id, folder_id, deleted_at = cursor.fetchone()
        assert (project_id, folder_id, deleted_at is not None) == (targets[U_C], F_C, True)
        cursor.execute("SELECT deleted_at FROM project_members WHERE project_id=%s AND user_id=%s", (P_C, U_B))
        assert cursor.fetchone()[0] is not None
        cursor.execute("SELECT deleted_at FROM project_members WHERE project_id=%s AND user_id=%s", (P_LEGACY, U_D))
        assert cursor.fetchone()[0] is not None


def test_migration_routes_links_and_activity_without_broadening_access() -> None:
    # Given
    _reset()
    _seed()

    # When
    command.upgrade(_alembic(), "ee55ff66aa77")

    # Then
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        targets = _targets(cursor)
        cursor.execute("SELECT project_id,is_enabled,deleted_at FROM share_links WHERE id=%s", (L_ROOT,))
        assert cursor.fetchone() == (targets[U_B], True, None)
        cursor.execute("SELECT id,is_enabled,deleted_at FROM share_links WHERE id IN (%s,%s)", (L_MIXED, L_EMPTY))
        assert all(enabled is False and deleted_at is not None for _, enabled, deleted_at in cursor)
        cursor.execute("SELECT a.project_id FROM share_links l JOIN assets a ON a.id=l.asset_id WHERE l.id=%s", (L_ASSET,))
        assert cursor.fetchone()[0] == targets[U_B]
        cursor.execute("SELECT f.project_id FROM share_links l JOIN folders f ON f.id=l.folder_id WHERE l.id=%s", (L_FOLDER,))
        assert cursor.fetchone()[0] == targets[U_B]
        cursor.execute("SELECT l.deleted_at,a.project_id FROM share_links l JOIN assets a ON a.id=l.asset_id WHERE l.id=%s", (L_SOFT,))
        deleted_at, project_id = cursor.fetchone()
        assert (deleted_at is not None, project_id) == (True, targets[U_C])
        cursor.execute("SELECT id,project_id FROM activity_logs ORDER BY id")
        assert [row[1] for row in cursor] == [targets[U_B], targets[U_C], targets[U_D], targets[U_A]]


def test_migration_rolls_back_before_clean_rerun_when_index_creation_fails() -> None:
    # Given
    _reset()
    _seed()
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("CREATE INDEX uq_projects_active_quick_share_creator ON projects(name)")

    # When
    with pytest.raises(ProgrammingError):
        command.upgrade(_alembic(), "ee55ff66aa77")

    # Then
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT project_id FROM assets WHERE id=%s", (A_B,))
        assert cursor.fetchone()[0] == P_LEGACY
        cursor.execute("SELECT version_num FROM alembic_version")
        assert cursor.fetchone()[0] == "dd44ee55ff66"
        cursor.execute("DROP INDEX uq_projects_active_quick_share_creator")
    command.upgrade(_alembic(), "ee55ff66aa77")
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        assert _targets(cursor)[U_B] != P_LEGACY


def test_partial_unique_index_and_downgrade_are_data_nondestructive() -> None:
    # Given
    _reset()
    _seed()
    command.upgrade(_alembic(), "ee55ff66aa77")
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        target_b = _targets(cursor)[U_B]

    # When / Then
    with pytest.raises(errors.UniqueViolation), psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO projects (id,name,project_type,created_by,is_quick_share) "
                "VALUES (%s,'Duplicate','personal',%s,true)",
                (UUID(int=999), U_B),
            )
    command.downgrade(_alembic(), "dd44ee55ff66")
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('uq_projects_active_quick_share_creator')")
        assert cursor.fetchone()[0] is None
        cursor.execute("SELECT project_id FROM assets WHERE id=%s", (A_B,))
        assert cursor.fetchone()[0] == target_b
        cursor.execute("SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL")
        assert cursor.fetchone()[0] == 5


def test_project_model_declares_the_partial_unique_index() -> None:
    # Given
    from models.project import Project

    # When
    index = next(index for index in Project.__table__.indexes if index.name == "uq_projects_active_quick_share_creator")

    # Then
    assert index.unique is True
    predicate = str(index.dialect_options["postgresql"]["where"].compile(dialect=postgresql.dialect()))
    assert predicate == "is_quick_share IS TRUE AND deleted_at IS NULL"
