#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/postgres /data/minio /data/redis
chown -R postgres:postgres /data/postgres

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

if [ -z "${JWT_SECRET:-}" ]; then
  if [ ! -f /data/secrets.env ]; then
    echo "JWT_SECRET=$(head -c32 /dev/urandom | base64 | tr -d '/+=')" > /data/secrets.env
  fi
  set -a
  . /data/secrets.env
  set +a
fi
export JWT_SECRET

echo "[entrypoint] starting supervisord"
exec supervisord -c /etc/supervisor/conf.d/freeframe.conf
