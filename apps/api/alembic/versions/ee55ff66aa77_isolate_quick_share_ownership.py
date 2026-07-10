import uuid

import sqlalchemy as sa
from alembic import op


revision = "ee55ff66aa77"
down_revision = "dd44ee55ff66"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text(
        "CREATE TEMP TABLE ff_qs_legacy_projects ON COMMIT DROP AS "
        "SELECT id,created_by FROM projects "
        "WHERE is_quick_share IS TRUE AND deleted_at IS NULL"
    ))
    represented = connection.execute(sa.text("""
        SELECT DISTINCT legacy_project_id,user_id FROM (
          SELECT id AS legacy_project_id,created_by AS user_id FROM ff_qs_legacy_projects
          UNION ALL
          SELECT p.id,a.created_by FROM ff_qs_legacy_projects p JOIN assets a ON a.project_id=p.id
          UNION ALL
          SELECT p.id,f.created_by FROM ff_qs_legacy_projects p JOIN folders f ON f.project_id=p.id
          UNION ALL
          SELECT p.id,l.created_by FROM ff_qs_legacy_projects p JOIN share_links l ON l.project_id=p.id
          UNION ALL
          SELECT p.id,l.created_by FROM ff_qs_legacy_projects p JOIN assets a ON a.project_id=p.id
            JOIN share_links l ON l.asset_id=a.id
          UNION ALL
          SELECT p.id,l.created_by FROM ff_qs_legacy_projects p JOIN folders f ON f.project_id=p.id
            JOIN share_links l ON l.folder_id=f.id
          UNION ALL
          SELECT p.id,m.user_id FROM ff_qs_legacy_projects p JOIN project_members m ON m.project_id=p.id
        ) represented_users
    """)).all()
    user_ids = sorted({row.user_id for row in represented}, key=str)
    connection.execute(sa.text(
        "CREATE TEMP TABLE ff_qs_targets "
        "(user_id uuid PRIMARY KEY,target_project_id uuid NOT NULL) ON COMMIT DROP"
    ))
    target_by_user: dict[uuid.UUID, uuid.UUID] = {}
    for user_id in user_ids:
        target_id = connection.execute(
            sa.text("""
                SELECT id FROM projects
                WHERE created_by=:user_id AND is_quick_share IS TRUE AND deleted_at IS NULL
                ORDER BY created_at,id LIMIT 1
            """),
            {"user_id": user_id},
        ).scalar_one_or_none()
        if target_id is None:
            target_id = uuid.uuid4()
            connection.execute(sa.text("""
                INSERT INTO projects
                  (id,name,description,project_type,created_by,is_public,is_quick_share,created_at,deleted_at)
                VALUES (:id,'Quick Shares',NULL,'personal',:user_id,false,true,CURRENT_TIMESTAMP,NULL)
            """), {"id": target_id, "user_id": user_id})
        target_by_user[user_id] = target_id
        connection.execute(
            sa.text("INSERT INTO ff_qs_targets VALUES (:user_id,:target_id)"),
            {"user_id": user_id, "target_id": target_id},
        )
        updated = connection.execute(sa.text("""
            UPDATE project_members SET role='owner',deleted_at=NULL
            WHERE project_id=:target_id AND user_id=:user_id
        """), {"target_id": target_id, "user_id": user_id})
        if updated.rowcount == 0:
            connection.execute(sa.text("""
                INSERT INTO project_members
                  (id,project_id,user_id,role,invited_by,invited_at,deleted_at)
                VALUES (:id,:target_id,:user_id,'owner',:user_id,CURRENT_TIMESTAMP,NULL)
            """), {"id": uuid.uuid4(), "target_id": target_id, "user_id": user_id})
    connection.execute(sa.text(
        "CREATE TEMP TABLE ff_qs_map "
        "(legacy_project_id uuid,user_id uuid,target_project_id uuid,"
        "PRIMARY KEY (legacy_project_id,user_id)) ON COMMIT DROP"
    ))
    for row in represented:
        connection.execute(sa.text("INSERT INTO ff_qs_map VALUES (:legacy_id,:user_id,:target_id)"), {
            "legacy_id": row.legacy_project_id,
            "user_id": row.user_id,
            "target_id": target_by_user[row.user_id],
        })
    connection.execute(sa.text("""
        CREATE TEMP TABLE ff_qs_moved_folders ON COMMIT DROP AS
        SELECT f.id,m.target_project_id FROM folders f JOIN ff_qs_map m
          ON m.legacy_project_id=f.project_id AND m.user_id=f.created_by;
        ALTER TABLE ff_qs_moved_folders ADD PRIMARY KEY (id);
        UPDATE folders f SET parent_id=NULL FROM ff_qs_moved_folders moved
        WHERE f.id=moved.id AND f.parent_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ff_qs_moved_folders parent
          WHERE parent.id=f.parent_id AND parent.target_project_id=moved.target_project_id
        );
        UPDATE folders f SET project_id=moved.target_project_id
        FROM ff_qs_moved_folders moved WHERE f.id=moved.id;
        CREATE TEMP TABLE ff_qs_moved_assets ON COMMIT DROP AS
        SELECT a.id,m.target_project_id FROM assets a JOIN ff_qs_map m
          ON m.legacy_project_id=a.project_id AND m.user_id=a.created_by;
        ALTER TABLE ff_qs_moved_assets ADD PRIMARY KEY (id);
        UPDATE assets a SET folder_id=NULL FROM ff_qs_moved_assets moved
        WHERE a.id=moved.id AND a.folder_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ff_qs_moved_folders folder
          WHERE folder.id=a.folder_id AND folder.target_project_id=moved.target_project_id
        );
        UPDATE assets a SET project_id=moved.target_project_id
        FROM ff_qs_moved_assets moved WHERE a.id=moved.id;
        CREATE TEMP TABLE ff_qs_root_links ON COMMIT DROP AS
        SELECT l.id FROM share_links l JOIN ff_qs_legacy_projects p ON p.id=l.project_id;
        CREATE TEMP TABLE ff_qs_valid_root_links ON COMMIT DROP AS
        SELECT root.id,MIN(COALESCE(asset.target_project_id,folder.target_project_id)::text)::uuid AS target_project_id
        FROM ff_qs_root_links root JOIN share_link_items item ON item.share_link_id=root.id
        LEFT JOIN ff_qs_moved_assets asset ON asset.id=item.asset_id
        LEFT JOIN ff_qs_moved_folders folder ON folder.id=item.folder_id
        GROUP BY root.id HAVING COUNT(*)=COUNT(COALESCE(asset.target_project_id,folder.target_project_id))
          AND COUNT(DISTINCT COALESCE(asset.target_project_id,folder.target_project_id))=1;
        UPDATE share_links link SET project_id=valid.target_project_id
        FROM ff_qs_valid_root_links valid WHERE link.id=valid.id;
        UPDATE share_links link SET is_enabled=false,deleted_at=COALESCE(link.deleted_at,CURRENT_TIMESTAMP)
        FROM ff_qs_root_links root WHERE link.id=root.id
          AND NOT EXISTS (SELECT 1 FROM ff_qs_valid_root_links valid WHERE valid.id=root.id);
        UPDATE activity_logs activity SET project_id=moved.target_project_id
        FROM ff_qs_moved_assets moved WHERE activity.asset_id=moved.id;
        UPDATE activity_logs activity SET project_id=mapping.target_project_id
        FROM ff_qs_map mapping WHERE activity.project_id=mapping.legacy_project_id
          AND activity.user_id=mapping.user_id AND NOT EXISTS (
            SELECT 1 FROM ff_qs_moved_assets moved WHERE moved.id=activity.asset_id
          );
        UPDATE project_members member SET deleted_at=COALESCE(member.deleted_at,CURRENT_TIMESTAMP)
        FROM ff_qs_legacy_projects legacy,ff_qs_targets target
        WHERE member.project_id=legacy.id AND member.user_id=target.user_id
          AND member.project_id<>target.target_project_id;
        UPDATE projects project SET deleted_at=CURRENT_TIMESTAMP FROM ff_qs_targets target
        WHERE project.created_by=target.user_id AND project.is_quick_share IS TRUE
          AND project.deleted_at IS NULL AND project.id<>target.target_project_id;
    """))
    op.create_index(
        "uq_projects_active_quick_share_creator",
        "projects",
        ["created_by"],
        unique=True,
        postgresql_where=sa.text("is_quick_share IS TRUE AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_projects_active_quick_share_creator", table_name="projects")
