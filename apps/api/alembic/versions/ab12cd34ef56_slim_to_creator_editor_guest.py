"""slim to creator + editor + guest

Drops everything the one-creator product no longer uses:
- in-app notifications, mentions and the activity feed
- metadata fields, asset metadata and collections (+ legacy collection_shares)
- asset assignment/due dates and the unused rating/keywords columns
- public projects and project types
- direct user shares (asset_shares)
- project-wide / multi-item share links (share_links.project_id,
  share_link_items) and the share link activity log
- project branding and watermark settings (project_brandings,
  watermark_settings) and the never-set share_links.password_encrypted
- image carousels (carousel_items, annotations.carousel_position, the
  image_carousel asset type) and audio's placeholder waveform "thumbnails"
- the share-link "approve" permission (approve links become comment links)

Project roles collapse to owner/editor; reviewer and viewer members become
editors. Project-scoped share links are deleted (their tokens stop working).

Downgrade restores the schema shape only; dropped rows are gone.

Revision ID: ab12cd34ef56
Revises: aa00bb22cc33
Create Date: 2026-09-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "ab12cd34ef56"
down_revision: Union[str, Sequence[str], None] = "aa00bb22cc33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ASSET_OR_FOLDER = (
    "(asset_id IS NOT NULL AND folder_id IS NULL) "
    "OR (asset_id IS NULL AND folder_id IS NOT NULL)"
)
ASSET_OR_FOLDER_OR_PROJECT = (
    "(asset_id IS NOT NULL AND folder_id IS NULL AND project_id IS NULL) "
    "OR (asset_id IS NULL AND folder_id IS NOT NULL AND project_id IS NULL) "
    "OR (asset_id IS NULL AND folder_id IS NULL AND project_id IS NOT NULL)"
)
DROPPED_ENUMS = {
    "notificationtype": ("mention", "assignment", "due_soon", "comment", "approval"),
    "fieldtype": ("text", "number", "date", "select", "multi_select"),
    "shareactivityaction": ("opened", "viewed_asset", "commented", "approved", "rejected", "downloaded"),
    "projecttype": ("personal", "team"),
    "viewerlayout": ("grid", "reel"),
    "watermarkposition": ("center", "corner", "tiled"),
    "watermarkcontent": ("email", "name", "custom_text"),
}


def _enum(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(*DROPPED_ENUMS[name], name=name, create_type=False)


def _swap_enum(name: str, table: str, column: str, values: tuple[str, ...]) -> None:
    op.execute(f"ALTER TYPE {name} RENAME TO {name}_old")
    postgresql.ENUM(*values, name=name).create(op.get_bind())
    op.execute(
        f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {name} "
        f"USING {column}::text::{name}"
    )
    op.execute(f"DROP TYPE {name}_old")


def _swap_projectrole(values: tuple[str, ...]) -> None:
    _swap_enum("projectrole", "project_members", "role", values)


def upgrade() -> None:
    # Tables referencing share_links go first: we delete share_links rows below.
    op.drop_table("share_link_activity")
    op.drop_table("share_link_items")
    op.drop_table("watermark_settings")
    op.drop_table("project_brandings")

    # Project-wide and multi-item links have neither asset nor folder scope.
    op.execute("DELETE FROM share_links WHERE asset_id IS NULL AND folder_id IS NULL")
    op.drop_constraint("ck_share_link_asset_or_folder_or_project", "share_links", type_="check")
    op.drop_index("ix_share_links_project_id", table_name="share_links")
    op.drop_column("share_links", "project_id")
    op.drop_column("share_links", "password_encrypted")
    op.create_check_constraint("ck_share_link_asset_or_folder", "share_links", ASSET_OR_FOLDER)

    op.drop_table("asset_shares")
    op.drop_table("notifications")
    op.drop_table("mentions")
    op.drop_table("activity_logs")
    op.drop_table("asset_metadata")
    op.drop_table("metadata_fields")
    op.drop_table("collection_shares")
    op.drop_table("collections")

    op.drop_index("ix_assets_assignee_id", table_name="assets")
    op.drop_column("assets", "assignee_id")
    op.drop_column("assets", "due_date")
    op.drop_column("assets", "keywords")
    op.drop_column("assets", "rating")

    op.drop_column("projects", "project_type")
    op.drop_column("projects", "is_public")

    op.execute("UPDATE project_members SET role = 'editor' WHERE role IN ('reviewer', 'viewer')")
    _swap_projectrole(("owner", "editor"))

    for name in DROPPED_ENUMS:
        op.execute(f"DROP TYPE {name}")

    # Image carousels were never creatable; fold any strays into plain images.
    op.drop_table("carousel_items")
    op.drop_column("annotations", "carousel_position")
    op.execute("UPDATE assets SET asset_type = 'image' WHERE asset_type = 'image_carousel'")
    _swap_enum("assettype", "assets", "asset_type", ("image", "audio", "video"))

    # Share links no longer grant approval; only signed-in members approve.
    op.execute("UPDATE share_links SET permission = 'comment' WHERE permission = 'approve'")
    _swap_enum("sharepermission", "share_links", "permission", ("view", "comment"))

    # Audio stored a placeholder waveform JSON as its "thumbnail"; it's not an image.
    op.execute("UPDATE media_files SET s3_key_thumbnail = NULL WHERE file_type = 'audio'")


def downgrade() -> None:
    bind = op.get_bind()
    _swap_enum("sharepermission", "share_links", "permission", ("view", "comment", "approve"))
    _swap_enum("assettype", "assets", "asset_type", ("image", "image_carousel", "audio", "video"))
    op.add_column("annotations", sa.Column("carousel_position", sa.Integer(), nullable=True))
    op.create_table(
        "carousel_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("version_id", sa.UUID(), nullable=False),
        sa.Column("media_file_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["media_file_id"], ["media_files.id"]),
        sa.ForeignKeyConstraint(["version_id"], ["asset_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    for name, values in DROPPED_ENUMS.items():
        postgresql.ENUM(*values, name=name).create(bind)
    _swap_projectrole(("owner", "editor", "reviewer", "viewer"))

    op.add_column("projects", sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False))
    op.add_column(
        "projects",
        sa.Column("project_type", _enum("projecttype"), server_default="personal", nullable=False),
    )

    op.add_column("assets", sa.Column("rating", sa.Integer(), nullable=True))
    op.add_column("assets", sa.Column("keywords", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("assets", sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("assets", sa.Column("assignee_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=True))
    op.create_index("ix_assets_assignee_id", "assets", ["assignee_id"], unique=False)

    op.create_table(
        "collections",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("filter_rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "collection_shares",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("collection_id", sa.UUID(), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column(
            "permission",
            postgresql.ENUM("view", "comment", "approve", name="sharepermission", create_type=False),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_table(
        "metadata_fields",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("field_type", _enum("fieldtype"), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "asset_metadata",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("asset_id", sa.UUID(), nullable=False),
        sa.Column("field_id", sa.UUID(), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["field_id"], ["metadata_fields.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id", "field_id", name="uq_asset_metadata_asset_field"),
    )
    op.create_index("ix_asset_metadata_asset_id", "asset_metadata", ["asset_id"], unique=False)
    op.create_index("ix_asset_metadata_field_id", "asset_metadata", ["field_id"], unique=False)

    op.create_table(
        "activity_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=True),
        sa.Column("project_id", sa.UUID(), nullable=True),
        sa.Column("asset_id", sa.UUID(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("asset_id", "org_id", "project_id", "user_id"):
        op.create_index(f"ix_activity_logs_{column}", "activity_logs", [column], unique=False)
    op.create_table(
        "mentions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("comment_id", sa.UUID(), nullable=False),
        sa.Column("mentioned_user_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["mentioned_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mentions_comment_id", "mentions", ["comment_id"], unique=False)
    op.create_index("ix_mentions_mentioned_user_id", "mentions", ["mentioned_user_id"], unique=False)
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("type", _enum("notificationtype"), nullable=False),
        sa.Column("asset_id", sa.UUID(), nullable=False),
        sa.Column("comment_id", sa.UUID(), nullable=True),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_asset_id", "notifications", ["asset_id"], unique=False)
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)

    op.create_table(
        "asset_shares",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("asset_id", sa.UUID(), nullable=True),
        sa.Column("folder_id", sa.UUID(), nullable=True),
        sa.Column("shared_with_user_id", sa.UUID(), nullable=True),
        sa.Column("shared_with_team_id", sa.UUID(), nullable=True),
        sa.Column(
            "permission",
            postgresql.ENUM("view", "comment", "approve", name="sharepermission", create_type=False),
            nullable=False,
        ),
        sa.Column("shared_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(ASSET_OR_FOLDER, name="ck_asset_share_asset_or_folder"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"]),
        sa.ForeignKeyConstraint(["shared_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["shared_with_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_shares_folder_id", "asset_shares", ["folder_id"], unique=False)

    op.drop_constraint("ck_share_link_asset_or_folder", "share_links", type_="check")
    op.add_column("share_links", sa.Column("password_encrypted", sa.String(length=512), nullable=True))
    op.add_column("share_links", sa.Column("project_id", sa.UUID(), sa.ForeignKey("projects.id"), nullable=True))
    op.create_index("ix_share_links_project_id", "share_links", ["project_id"])
    op.create_check_constraint(
        "ck_share_link_asset_or_folder_or_project",
        "share_links",
        ASSET_OR_FOLDER_OR_PROJECT,
    )
    op.create_table(
        "share_link_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("share_link_id", sa.UUID(), nullable=False),
        sa.Column("asset_id", sa.UUID(), nullable=True),
        sa.Column("folder_id", sa.UUID(), nullable=True),
        sa.CheckConstraint(ASSET_OR_FOLDER, name="ck_share_link_item_asset_or_folder"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"]),
        sa.ForeignKeyConstraint(["share_link_id"], ["share_links.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_share_link_items_share_link_id", "share_link_items", ["share_link_id"], unique=False)
    op.create_table(
        "share_link_activity",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("share_link_id", sa.UUID(), nullable=False),
        sa.Column("action", _enum("shareactivityaction"), nullable=False),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("actor_name", sa.String(255), nullable=True),
        sa.Column("asset_id", sa.UUID(), nullable=True),
        sa.Column("asset_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["share_link_id"], ["share_links.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_share_link_activity_share_link_id", "share_link_activity", ["share_link_id"], unique=False)
    op.create_index(
        "ix_share_activity_link_created",
        "share_link_activity",
        ["share_link_id", sa.text("created_at DESC")],
    )

    op.create_table(
        "project_brandings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("logo_s3_key", sa.String(length=1000), nullable=True),
        sa.Column("primary_color", sa.String(length=7), nullable=True),
        sa.Column("secondary_color", sa.String(length=7), nullable=True),
        sa.Column("custom_title", sa.String(length=255), nullable=True),
        sa.Column("custom_footer", sa.String(length=500), nullable=True),
        sa.Column("viewer_layout", _enum("viewerlayout"), nullable=False),
        sa.Column("featured_field", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id"),
    )
    op.create_table(
        "watermark_settings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("share_link_id", sa.UUID(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("position", _enum("watermarkposition"), nullable=False),
        sa.Column("content", _enum("watermarkcontent"), nullable=False),
        sa.Column("custom_text", sa.String(length=255), nullable=True),
        sa.Column("opacity", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["share_link_id"], ["share_links.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
