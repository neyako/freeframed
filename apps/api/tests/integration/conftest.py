import os
import importlib
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

TEST_DB_URL = os.getenv("TEST_DATABASE_URL")
REPO_ROOT = Path(__file__).resolve().parents[4]
INTEGRATION_DIR = Path(__file__).resolve().parent

os.environ.setdefault(
    "DATABASE_URL",
    TEST_DB_URL or "postgresql://user:pass@localhost:5432/unused",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("S3_BUCKET", "freeframe-test")
os.environ.setdefault("S3_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("S3_ACCESS_KEY", "testkey")
os.environ.setdefault("S3_SECRET_KEY", "testsecret")
os.environ.setdefault("S3_REGION", "us-east-1")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-key-for-tests-only")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")


def pytest_collection_modifyitems(
    config: pytest.Config,
    items: list[pytest.Item],
) -> None:
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL not set")
    for item in items:
        item_path = Path(str(item.fspath))
        if INTEGRATION_DIR not in item_path.parents:
            continue
        item.add_marker(pytest.mark.integration)
        if not TEST_DB_URL:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def migrated_engine():
    if not TEST_DB_URL:
        pytest.skip("TEST_DATABASE_URL not set")

    from sqlalchemy import create_engine

    subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(REPO_ROOT / "apps/api/alembic.ini"),
            "upgrade",
            "head",
        ],
        check=True,
        cwd=REPO_ROOT,
        env={**os.environ, "DATABASE_URL": TEST_DB_URL},
    )
    engine = create_engine(TEST_DB_URL)
    yield engine
    engine.dispose()


@pytest.fixture()
def db(migrated_engine):
    importlib.import_module("apps.api.models")
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker

    from apps.api.database import Base

    session_factory = sessionmaker(bind=migrated_engine)
    session = session_factory()
    yield session
    session.rollback()
    session.close()

    tables = ", ".join(f'"{table.name}"' for table in reversed(Base.metadata.sorted_tables))
    with migrated_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture()
def make_user(db):
    from apps.api.models.user import User, UserStatus

    def _make(email: str | None = None, name: str = "Test User") -> User:
        user = User(
            email=email or f"{uuid.uuid4().hex[:8]}@example.com",
            name=name,
            status=UserStatus.active,
            email_verified=True,
        )
        db.add(user)
        db.flush()
        return user

    return _make


@pytest.fixture()
def make_project(db, make_user):
    from apps.api.models.project import Project

    def _make(is_public: bool = False):
        owner = make_user()
        project = Project(name="Project", created_by=owner.id, is_public=is_public)
        db.add(project)
        db.flush()
        return project, owner

    return _make
