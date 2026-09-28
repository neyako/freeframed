#!/usr/bin/env bash
set -euo pipefail

echo "[init] waiting for postgres"
until pg_isready -h 127.0.0.1 -p 5432 -U freeframe >/dev/null 2>&1; do
  sleep 1
done

echo "[init] running migrations"
cd /workspace/apps/api && /opt/venv/bin/alembic upgrade head

# The bucket is created by the API on startup (ensure_bucket_exists)

echo "[init] done"
