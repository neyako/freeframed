#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/postgres /data/minio /data/redis
chown -R postgres:postgres /data/postgres
SECRETS_FILE=/data/secrets.env

PGBIN="$(ls -d /usr/lib/postgresql/*/bin | head -n1)"
export PGBIN

if [ ! -s /data/postgres/PG_VERSION ]; then
  echo "[entrypoint] initialising postgres in /data/postgres"
  su postgres -c "$PGBIN/initdb -D /data/postgres --auth=trust --encoding=UTF8"
  su postgres -c "$PGBIN/pg_ctl -D /data/postgres -o '-c listen_addresses=127.0.0.1 -p 5432' -w start"
  su postgres -c "psql -v ON_ERROR_STOP=1 --command \"CREATE ROLE freeframe WITH LOGIN PASSWORD 'freeframe' SUPERUSER;\""
  su postgres -c "createdb -O freeframe freeframe"
  su postgres -c "$PGBIN/pg_ctl -D /data/postgres -m fast -w stop"
fi

touch "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
set -a
. "$SECRETS_FILE"
set +a

random_secret() {
  head -c32 /dev/urandom | base64 | tr -d '/+='
}

persist_secret() {
  printf '%s=%s\n' "$1" "$2" >> "$SECRETS_FILE"
  export "$1=$2"
}

if [ -z "${JWT_SECRET:-}" ]; then
  persist_secret JWT_SECRET "$(random_secret)"
fi

if [ -z "${SETUP_TOKEN:-}" ]; then
  persist_secret SETUP_TOKEN "$(random_secret)"
  echo "[entrypoint] setup token generated in $SECRETS_FILE"
fi

if [ "${S3_ACCESS_KEY:-minioadmin}" = "minioadmin" ] || [ "${S3_SECRET_KEY:-minioadmin}" = "minioadmin" ]; then
  if [ "${LOCAL_MODE:-false}" != "true" ]; then
    echo "[entrypoint] refusing to start with default S3/MinIO credentials outside LOCAL_MODE=true" >&2
    exit 1
  fi
  if [ -z "${GENERATED_S3_ACCESS_KEY:-}" ]; then
    persist_secret GENERATED_S3_ACCESS_KEY "ff_$(random_secret)"
  fi
  if [ -z "${GENERATED_S3_SECRET_KEY:-}" ]; then
    persist_secret GENERATED_S3_SECRET_KEY "$(random_secret)$(random_secret)"
  fi
  S3_ACCESS_KEY="$GENERATED_S3_ACCESS_KEY"
  S3_SECRET_KEY="$GENERATED_S3_SECRET_KEY"
fi

if [ "${MINIO_ROOT_USER:-minioadmin}" = "minioadmin" ] || [ "${MINIO_ROOT_PASSWORD:-minioadmin}" = "minioadmin" ]; then
  if [ "${LOCAL_MODE:-false}" != "true" ]; then
    echo "[entrypoint] refusing to start with default MinIO root credentials outside LOCAL_MODE=true" >&2
    exit 1
  fi
  MINIO_ROOT_USER="$S3_ACCESS_KEY"
  MINIO_ROOT_PASSWORD="$S3_SECRET_KEY"
fi

export JWT_SECRET SETUP_TOKEN S3_ACCESS_KEY S3_SECRET_KEY MINIO_ROOT_USER MINIO_ROOT_PASSWORD

echo "[entrypoint] starting supervisord"
exec supervisord -c /etc/supervisor/conf.d/freeframe.conf
