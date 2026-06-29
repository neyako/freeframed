#!/usr/bin/env bash
set -euo pipefail

echo "[init] waiting for postgres"
until pg_isready -h 127.0.0.1 -p 5432 -U freeframe >/dev/null 2>&1; do
  sleep 1
done

echo "[init] running migrations"
cd /workspace/apps/api && /opt/venv/bin/alembic upgrade head

echo "[init] waiting for minio"
until curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; do
  sleep 1
done

echo "[init] ensuring bucket ${S3_BUCKET:-freeframe}"
mc alias set local http://127.0.0.1:9000 "${S3_ACCESS_KEY:-minioadmin}" "${S3_SECRET_KEY:-minioadmin}"
mc mb --ignore-existing "local/${S3_BUCKET:-freeframe}"

echo "[init] done"
