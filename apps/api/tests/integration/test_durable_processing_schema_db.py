from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import psycopg2
import pytest
from alembic import command
from alembic.config import Config
from psycopg2 import Error as PsycopgError
from psycopg2.extras import Json, register_uuid
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session


ROOT = Path(__file__).resolve().parents[4]
API_ROOT = ROOT / "apps/api"
DATABASE_URL = os.getenv("TEST_DATABASE_URL")
if DATABASE_URL is None:
    pytest.skip("TEST_DATABASE_URL not set", allow_module_level=True)
database_parts = urlparse(DATABASE_URL)
if (database_parts.scheme, database_parts.hostname, database_parts.port, database_parts.path, database_parts.username, database_parts.password) != ("postgresql", "127.0.0.1", 55433, "/freeframed_task3", "postgres", None):
    raise pytest.UsageError("Task 3 integration tests require the exact loopback freeframed_task3 database")
os.environ["DATABASE_URL"] = DATABASE_URL
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")
os.environ.setdefault("JWT_SECRET", "task3-integration-synthetic-secret")
sys.path.insert(0, str(API_ROOT))
register_uuid()

HEAD = "ff66aa77bb88"
USER_ID, PROJECT_ID, ASSET_ID, VERSION_ID = (UUID(int=value) for value in range(1, 5))
TASK_ID, OUTBOX_ID, INGEST_ID, SHARE_ID = (UUID(int=value) for value in range(11, 15))
KEY_HASH = "a" * 64
CONTENT_DIGEST = "b" * 64
REQUEST_FINGERPRINT = "c" * 64


def _alembic() -> Config:
    return Config(str(API_ROOT / "alembic.ini"))


def _reset(revision: str = HEAD) -> None:
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),host(inet_server_addr()),inet_server_port()")
        assert cursor.fetchone() == ("freeframed_task3", "127.0.0.1", 55433)
        cursor.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
    command.upgrade(_alembic(), revision)


def _seed_project() -> None:
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO users (id,email,name,status,email_verified,is_superadmin) VALUES (%s,'schema-user@invalid.test','Schema User','active',true,false)", (USER_ID,))
        cursor.execute("INSERT INTO projects (id,name,project_type,created_by) VALUES (%s,'Schema Project','personal',%s)", (PROJECT_ID, USER_ID))


def test_empty_database_upgrades_with_exact_schema_contract() -> None:
    _reset()

    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT version_num FROM alembic_version")
        assert cursor.fetchone() == (HEAD,)
        cursor.execute("SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN ('processingstatus','taskoutboxstate','reviewingestrequeststate') ORDER BY t.typname,e.enumsortorder")
        enum_values: dict[str, list[str]] = {}
        for enum_name, value in cursor.fetchall():
            enum_values.setdefault(enum_name, []).append(value)
        assert enum_values == {
            "processingstatus": ["uploading", "queued", "processing", "ready", "failed"],
            "reviewingestrequeststate": ["reserved", "completed"],
            "taskoutboxstate": ["pending", "publishing", "published"],
        }
        cursor.execute("SELECT table_name,column_name,data_type,udt_name,is_nullable,character_maximum_length,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('media_files','asset_versions','task_outbox','review_ingest_requests')")
        columns = {(row[0], row[1]): row[2:] for row in cursor.fetchall()}
        assert {key: columns[key] for key in {
            ("media_files", "upload_completed_at"), ("media_files", "upload_aborted_at"),
            ("media_files", "completion_fingerprint"), ("media_files", "raw_object_etag"),
            ("media_files", "raw_object_size"), ("asset_versions", "processing_started_at"),
            ("asset_versions", "processing_finished_at"), ("asset_versions", "processing_error"),
        }} == {
            ("media_files", "upload_completed_at"): ("timestamp with time zone", "timestamptz", "YES", None, None), ("media_files", "upload_aborted_at"): ("timestamp with time zone", "timestamptz", "YES", None, None),
            ("media_files", "completion_fingerprint"): ("character varying", "varchar", "YES", 64, None), ("media_files", "raw_object_etag"): ("character varying", "varchar", "YES", 255, None),
            ("media_files", "raw_object_size"): ("bigint", "int8", "YES", None, None), ("asset_versions", "processing_started_at"): ("timestamp with time zone", "timestamptz", "YES", None, None),
            ("asset_versions", "processing_finished_at"): ("timestamp with time zone", "timestamptz", "YES", None, None), ("asset_versions", "processing_error"): ("text", "text", "YES", None, None),
        }
        expected_types = {
            ("uuid", "uuid", "NO", None): "task_outbox.id task_outbox.task_id review_ingest_requests.id review_ingest_requests.project_id review_ingest_requests.asset_id review_ingest_requests.version_id review_ingest_requests.share_link_id".split(), ("uuid", "uuid", "YES", None): ["task_outbox.lease_token"],
            ("character varying", "varchar", "NO", 255): "task_outbox.dedupe_key task_outbox.task_name".split(), ("character varying", "varchar", "NO", 100): ["task_outbox.queue"],
            ("character varying", "varchar", "NO", 64): "review_ingest_requests.key_hash review_ingest_requests.content_digest review_ingest_requests.request_fingerprint".split(), ("character varying", "varchar", "NO", 1000): ["review_ingest_requests.s3_key"],
            ("jsonb", "jsonb", "NO", None): ["task_outbox.payload"], ("jsonb", "jsonb", "YES", None): ["review_ingest_requests.response_payload"],
            ("USER-DEFINED", "taskoutboxstate", "NO", None): ["task_outbox.state"], ("USER-DEFINED", "reviewingestrequeststate", "NO", None): ["review_ingest_requests.state"],
            ("integer", "int4", "NO", None): ["task_outbox.attempts"], ("text", "text", "YES", None): ["task_outbox.last_error"],
            ("timestamp with time zone", "timestamptz", "NO", None): "task_outbox.next_attempt_at task_outbox.created_at task_outbox.updated_at review_ingest_requests.created_at review_ingest_requests.updated_at".split(), ("timestamp with time zone", "timestamptz", "YES", None): "task_outbox.lease_expires_at task_outbox.claimed_at task_outbox.published_at review_ingest_requests.completed_at".split(),
        }
        for signature, expected_names in expected_types.items():
            assert {f"{table}.{column}" for (table, column), value in columns.items() if table in {"task_outbox", "review_ingest_requests"} and value[:4] == signature} == set(expected_names)
        assert {(table, column): value[-1] for (table, column), value in columns.items() if table in {"task_outbox", "review_ingest_requests"} and value[-1] is not None} == {
            ("task_outbox", "state"): "'pending'::taskoutboxstate", ("task_outbox", "attempts"): "0", ("task_outbox", "next_attempt_at"): "now()", ("task_outbox", "created_at"): "now()", ("task_outbox", "updated_at"): "now()",
            ("review_ingest_requests", "state"): "'reserved'::reviewingestrequeststate", ("review_ingest_requests", "created_at"): "now()", ("review_ingest_requests", "updated_at"): "now()",
        }
        cursor.execute("SELECT conname FROM pg_constraint WHERE conrelid IN ('task_outbox'::regclass,'review_ingest_requests'::regclass)")
        constraints = {row[0] for row in cursor.fetchall()}
        assert {
            "ck_task_outbox_attempts_nonnegative",
            "ck_task_outbox_lease_state",
            "ck_review_ingest_requests_hashes_sha256",
            "ck_review_ingest_requests_state_payload",
        } <= constraints
        cursor.execute("SELECT indexname FROM pg_indexes WHERE tablename='task_outbox'")
        assert "ix_task_outbox_state_next_attempt_at" in {row[0] for row in cursor.fetchall()}


def test_model_metadata_matches_database_contract() -> None:
    _reset()
    from models import ReviewIngestRequest, ReviewIngestRequestState, TaskOutbox, TaskOutboxState

    inspector = inspect(create_engine(DATABASE_URL))
    assert {TaskOutbox.__tablename__, ReviewIngestRequest.__tablename__} == {
        "task_outbox",
        "review_ingest_requests",
    }
    assert [state.value for state in TaskOutboxState] == ["pending", "publishing", "published"]
    assert [state.value for state in ReviewIngestRequestState] == ["reserved", "completed"]
    assert TaskOutbox.__table__.c.next_attempt_at.type.timezone is True
    assert ReviewIngestRequest.__table__.c.completed_at.type.timezone is True
    assert ReviewIngestRequest.__table__.c.response_payload.type.none_as_null is True
    assert TaskOutbox.__table__.c.state.type.name == "taskoutboxstate"
    assert ReviewIngestRequest.__table__.c.state.type.name == "reviewingestrequeststate"
    for model in (TaskOutbox, ReviewIngestRequest):
        database_columns = {column["name"]: column for column in inspector.get_columns(model.__tablename__)}
        assert set(database_columns) == set(model.__table__.c.keys())
        assert all(database_columns[column.name]["nullable"] is column.nullable for column in model.__table__.c)
        assert all(database_columns[column.name]["type"]._type_affinity is column.type._type_affinity and getattr(database_columns[column.name]["type"], "length", None) == getattr(column.type, "length", None) and getattr(database_columns[column.name]["type"], "timezone", False) == getattr(column.type, "timezone", False) for column in model.__table__.c if column.name != "state")
    for table, expected in (("task_outbox", {"uq_task_outbox_dedupe_key", "uq_task_outbox_task_id"}), ("review_ingest_requests", {"uq_review_ingest_requests_key_hash", "uq_review_ingest_requests_asset_id", "uq_review_ingest_requests_version_id", "uq_review_ingest_requests_share_link_id"})):
        assert {item["name"] for item in inspector.get_unique_constraints(table)} >= expected
    assert inspector.get_foreign_keys("review_ingest_requests")[0]["constrained_columns"] == ["project_id"]


def test_queued_version_outbox_and_reserved_ingest_commit_atomically() -> None:
    _reset()
    from models import Asset, AssetVersion, Project, ReviewIngestRequest, TaskOutbox, User
    from models.asset import AssetStatus, AssetType, ProcessingStatus
    from models.user import UserStatus

    engine = create_engine(DATABASE_URL)
    with Session(engine) as session, session.begin():
        session.add(User(id=USER_ID, email="orm-user@invalid.test", name="ORM User", status=UserStatus.active))
        session.flush()
        session.add(Project(id=PROJECT_ID, name="ORM Project", created_by=USER_ID))
        session.flush()
        session.add(Asset(id=ASSET_ID, project_id=PROJECT_ID, name="queued.mov", asset_type=AssetType.video, status=AssetStatus.draft, created_by=USER_ID))
        session.flush()
        session.add(AssetVersion(id=VERSION_ID, asset_id=ASSET_ID, version_number=1, processing_status=ProcessingStatus.queued, created_by=USER_ID))
        session.add(TaskOutbox(id=OUTBOX_ID, dedupe_key=f"process-version:{VERSION_ID}", task_id=TASK_ID, task_name="process_asset", payload={"version_id": str(VERSION_ID)}, queue="transcoding"))
        session.add(ReviewIngestRequest(id=INGEST_ID, key_hash=KEY_HASH, content_digest=CONTENT_DIGEST, request_fingerprint=REQUEST_FINGERPRINT, project_id=PROJECT_ID, asset_id=UUID(int=21), version_id=UUID(int=22), share_link_id=SHARE_ID, s3_key="reviews/synthetic/queued.mov", response_payload=None))
    with engine.connect() as connection:
        assert connection.execute(text("SELECT processing_status FROM asset_versions")).scalar_one() == "queued"
        assert connection.execute(text("SELECT COUNT(*) FROM task_outbox")).scalar_one() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM review_ingest_requests")).scalar_one() == 1
    engine.dispose()


@pytest.mark.parametrize(
    ("dedupe_key", "task_id"),
    [("dedupe", UUID(int=32)), ("dedupe-2", TASK_ID)],
)
def test_duplicate_outbox_identifiers_roll_back_atomically(dedupe_key: str, task_id: UUID) -> None:
    _reset()
    with pytest.raises(PsycopgError), psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO task_outbox (id,dedupe_key,task_id,task_name,payload,queue) VALUES (%s,'dedupe',%s,'process_asset','{}','transcoding')", (OUTBOX_ID, TASK_ID))
            cursor.execute("INSERT INTO task_outbox (id,dedupe_key,task_id,task_name,payload,queue) VALUES (%s,%s,%s,'process_asset','{}','transcoding')", (UUID(int=31), dedupe_key, task_id))
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM task_outbox")
        assert cursor.fetchone() == (0,)


@pytest.mark.parametrize(
    ("key_hash", "asset_id", "version_id", "share_link_id"),
    [
        (KEY_HASH, UUID(int=42), UUID(int=43), UUID(int=44)),
        ("d" * 64, UUID(int=41), UUID(int=43), UUID(int=44)),
        ("d" * 64, UUID(int=42), UUID(int=41), UUID(int=44)),
        ("d" * 64, UUID(int=42), UUID(int=43), UUID(int=41)),
    ],
)
def test_duplicate_ingest_reservations_roll_back_atomically(key_hash: str, asset_id: UUID, version_id: UUID, share_link_id: UUID) -> None:
    _reset()
    _seed_project()
    sql = "INSERT INTO review_ingest_requests (id,key_hash,content_digest,request_fingerprint,project_id,asset_id,version_id,share_link_id,s3_key) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"
    with pytest.raises(PsycopgError), psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, (INGEST_ID, KEY_HASH, CONTENT_DIGEST, REQUEST_FINGERPRINT, PROJECT_ID, UUID(int=41), UUID(int=41), UUID(int=41), "reviews/one"))
            cursor.execute(sql, (UUID(int=45), key_hash, "e" * 64, "f" * 64, PROJECT_ID, asset_id, version_id, share_link_id, "reviews/two"))
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM review_ingest_requests")
        assert cursor.fetchone() == (0,)


@pytest.mark.parametrize(
    ("state", "attempts", "lease_token", "lease_expires_at"),
    [
        ("pending", -1, None, None),
        ("publishing", 0, None, datetime.now(timezone.utc)),
        ("publishing", 0, UUID(int=51), None),
        ("pending", 0, UUID(int=51), datetime.now(timezone.utc)),
        ("published", 0, UUID(int=51), datetime.now(timezone.utc)),
        ("unknown", 0, None, None),
    ],
)
def test_invalid_outbox_states_roll_back_atomically(state: str, attempts: int, lease_token: UUID | None, lease_expires_at: datetime | None) -> None:
    _reset()
    sql = "INSERT INTO task_outbox (id,dedupe_key,task_id,task_name,payload,queue,state,attempts,lease_token,lease_expires_at) VALUES (%s,%s,%s,'process_asset','{}','transcoding',%s,%s,%s,%s)"
    with pytest.raises(PsycopgError), psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO task_outbox (id,dedupe_key,task_id,task_name,payload,queue) VALUES (%s,'valid',%s,'process_asset','{}','transcoding')", (OUTBOX_ID, TASK_ID))
            cursor.execute(sql, (UUID(int=52), "invalid", UUID(int=53), state, attempts, lease_token, lease_expires_at))
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM task_outbox")
        assert cursor.fetchone() == (0,)


@pytest.mark.parametrize(
    ("state", "completed_at", "response_payload", "content_digest"),
    [
        ("reserved", datetime.now(timezone.utc), None, CONTENT_DIGEST),
        ("reserved", None, Json({"ok": True}), CONTENT_DIGEST),
        ("completed", None, Json({"ok": True}), CONTENT_DIGEST),
        ("completed", datetime.now(timezone.utc), None, CONTENT_DIGEST),
        ("completed", datetime.now(timezone.utc), Json(None), CONTENT_DIGEST),
        ("unknown", None, None, CONTENT_DIGEST),
        ("reserved", None, None, "not-a-sha256"),
    ],
)
def test_invalid_ingest_states_and_hashes_roll_back_atomically(state: str, completed_at: datetime | None, response_payload: Json | None, content_digest: str) -> None:
    _reset()
    _seed_project()
    sql = "INSERT INTO review_ingest_requests (id,key_hash,content_digest,request_fingerprint,project_id,asset_id,version_id,share_link_id,s3_key,state,completed_at,response_payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
    with pytest.raises(PsycopgError), psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, (INGEST_ID, KEY_HASH, CONTENT_DIGEST, REQUEST_FINGERPRINT, PROJECT_ID, UUID(int=61), UUID(int=62), UUID(int=63), "reviews/valid", "reserved", None, None))
            cursor.execute(sql, (UUID(int=64), "d" * 64, content_digest, "e" * 64, PROJECT_ID, UUID(int=65), UUID(int=66), UUID(int=67), "reviews/invalid", state, completed_at, response_payload))
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM review_ingest_requests")
        assert cursor.fetchone() == (0,)


def test_expired_lease_completed_ingest_and_downgrade_reupgrade_are_supported() -> None:
    _reset()
    _seed_project()
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO task_outbox (id,dedupe_key,task_id,task_name,payload,queue,state,lease_token,lease_expires_at,claimed_at) VALUES (%s,'expired-lease',%s,'process_asset','{}','transcoding','publishing',%s,%s,%s)", (OUTBOX_ID, TASK_ID, UUID(int=71), datetime.now(timezone.utc) - timedelta(minutes=5), datetime.now(timezone.utc) - timedelta(minutes=10)))
        cursor.execute("INSERT INTO review_ingest_requests (id,key_hash,content_digest,request_fingerprint,project_id,asset_id,version_id,share_link_id,s3_key,state,completed_at,response_payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'reviews/completed','completed',%s,%s)", (INGEST_ID, KEY_HASH, CONTENT_DIGEST, REQUEST_FINGERPRINT, PROJECT_ID, UUID(int=72), UUID(int=73), SHARE_ID, datetime.now(timezone.utc), Json({"asset_id": str(UUID(int=72))})))
    command.downgrade(_alembic(), "ee55ff66aa77")
    with psycopg2.connect(DATABASE_URL) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('task_outbox'),to_regclass('review_ingest_requests')")
        assert cursor.fetchone() == (None, None)
        cursor.execute("SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='processingstatus' ORDER BY enumsortorder")
        assert [row[0] for row in cursor.fetchall()] == ["uploading", "queued", "processing", "ready", "failed"]
        cursor.execute("SELECT table_name,column_name FROM information_schema.columns WHERE table_name IN ('media_files','asset_versions')")
        remaining_columns = set(cursor.fetchall())
        assert not {("media_files", "upload_completed_at"), ("media_files", "upload_aborted_at"), ("media_files", "completion_fingerprint"), ("media_files", "raw_object_etag"), ("media_files", "raw_object_size"), ("asset_versions", "processing_started_at"), ("asset_versions", "processing_finished_at"), ("asset_versions", "processing_error")} & remaining_columns
        cursor.execute("SELECT typname FROM pg_type WHERE typname IN ('taskoutboxstate','reviewingestrequeststate')")
        assert cursor.fetchall() == []
    command.upgrade(_alembic(), HEAD)
