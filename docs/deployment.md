# freeframed Deployment Guide

freeframed is the NAS-first fork of
[FreeFrame](https://github.com/Techiebutler/freeframe). The deployment is one
container on one machine, with state in a host directory you can back up or
snapshot. This fork ships only the all-in-one path; if you need a
multi-container stack with separately managed services, use mainline FreeFrame.

This fork is for individual creators and small teams. SaaS, multi-tenant, and
production-house deployments belong upstream in mainline FreeFrame.

The commands, ports, bind mounts, and environment variables below were checked
against `docker-compose.aio.yml`, `Dockerfile.allinone`, and
`deploy/allinone/*`.

---

## All-In-One NAS Install

The all-in-one image bundles:

- nginx on container port `80`
- Next.js web on `127.0.0.1:3000`
- FastAPI on `127.0.0.1:8000`
- PostgreSQL on `127.0.0.1:5432`
- Redis on `127.0.0.1:6379`
- MinIO on `127.0.0.1:9000`
- Celery workers for transcoding, email, and beat

The default compose file publishes host port `8080` to container port `80` and
mounts `./data:/data`.

### Quick Start

```bash
git clone https://github.com/neyako/freeframed.git
cd freeframed
docker compose -f docker-compose.aio.yml up -d
```

Open `http://<host>:8080`. The container generates `JWT_SECRET` and
`SETUP_TOKEN` in `./data/secrets.env` when they are not provided. Use the
`SETUP_TOKEN` to create the first admin account.

Plain Docker:

```bash
docker run -d --name freeframe -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

NVIDIA host:

```bash
docker run -d --name freeframe --gpus all -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

Intel or AMD host:

```bash
docker run -d --name freeframe --device /dev/dri:/dev/dri -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

The current compose and image names still use `freeframe` internally; the fork
identity is `freeframed`.

### All-In-One Environment

Common overrides from the all-in-one Dockerfile and compose file:

| Variable | Default in all-in-one | Use |
|----------|------------------------|-----|
| `FRONTEND_URL` | `http://localhost:8080` in compose, `http://localhost` in image | Browser origin used for links and CORS |
| `CORS_ORIGINS` | `http://localhost:8080` in compose, `http://localhost` in image | Allowed browser origins |
| `TRANSCODE_HWACCEL` | `auto` | Hardware acceleration selection |
| `API_WORKERS` | `4` | Gunicorn worker processes |
| `TRANSCODING_CONCURRENCY` | `2` | Transcoding worker slots |
| `EMAIL_CONCURRENCY` | `2` | Email worker slots |
| `MINIO_ADDRESS` | `127.0.0.1:9000` | MinIO bind address inside the container |
| `S3_PUBLIC_ENDPOINT` | `FRONTEND_URL` (same origin) | Browser-facing object-storage endpoint; set only for external S3 |
| `SETUP_TOKEN` | generated in `/data/secrets.env` | First-admin setup token |
| `JWT_SECRET` | generated in `/data/secrets.env` | JWT signing secret |

Example with explicit secrets and public URL:

```bash
docker run -d --name freeframe \
  -p 80:80 \
  -v /srv/freeframe:/data \
  -e JWT_SECRET='replace-with-a-long-random-secret' \
  -e FRONTEND_URL='https://photos.example.com' \
  -e TRANSCODE_HWACCEL=auto \
  -e API_WORKERS=4 \
  -e TRANSCODING_CONCURRENCY=2 \
  ghcr.io/neyako/freeframe:edge
```

### Reverse Proxy

No reverse proxy is required on a trusted LAN. If you use nginx, Nginx Proxy
Manager, Caddy, or another proxy, forward it to host port `8080`, enable
websocket support, allow large request bodies, and set `FRONTEND_URL` and
`CORS_ORIGINS` to the public origin.

Nginx Proxy Manager: forward to `<host>:8080`, enable "Websockets Support", and
set `client_max_body_size 0` under Advanced / Custom Nginx Configuration.

nginx:

```nginx
server {
    listen 443 ssl;
    server_name review.example.com;
    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Caddy:

```caddy
review.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Then run with:

```bash
docker run -d --name freeframe \
  -p 80:80 \
  -v /srv/freeframe:/data \
  -e FRONTEND_URL='https://review.example.com' \
  -e CORS_ORIGINS='https://review.example.com' \
  ghcr.io/neyako/freeframe:edge
```

### Uploads and Object Storage

Media traffic — uploads, video segments, thumbnails, downloads — is served on
the same origin as the app. Presigned URLs are path-style
(`/<bucket>/<key>?...`) and the bundled nginx routes the bucket path to the
internal MinIO, which stays on `127.0.0.1:9000` inside the container. There is
no second domain, port, or CORS setup: one origin serves everything, on a LAN
or behind your reverse proxy.

The one invariant: `FRONTEND_URL` must equal the origin users type into their
browser, exactly — scheme, host, and port. Auth cookies, CORS, and media URLs
all derive from it.

To use external S3-compatible storage instead of the bundled MinIO, set
`S3_PUBLIC_ENDPOINT` to the browser-reachable origin of that service:

```bash
docker run -d --name freeframe \
  -p 80:80 \
  -e FRONTEND_URL='https://review.example.com' \
  -e S3_STORAGE='s3' \
  -e S3_ENDPOINT='https://s3.example.com' \
  -e S3_PUBLIC_ENDPOINT='https://s3.example.com' \
  -e S3_ACCESS_KEY='replace-with-a-random-access-key' \
  -e S3_SECRET_KEY='replace-with-a-long-random-secret' \
  -v /srv/freeframe:/data \
  ghcr.io/neyako/freeframe:edge
```

With external S3, the bucket must allow CORS from the `FRONTEND_URL` origin.

### Data and Backups

All all-in-one state lives under `/data` in the container. With the default
compose file that is `./data` on the host. With the Docker examples above it is
`/srv/freeframe` on the host.

Back up this directory before upgrades and on a regular schedule. It contains
PostgreSQL data, MinIO objects, Redis append-only data, and `secrets.env`.

After the container is running, verify available H.264 encoders:

```bash
docker exec freeframe /usr/local/bin/ffmpeg -hide_banner -encoders | grep h264
```

### Updates

```bash
docker compose -f docker-compose.aio.yml pull
docker compose -f docker-compose.aio.yml up -d
```

Migrations run on API startup. Back up `/data` before updating and check the
changelog for breaking changes.

### Health and Logs

The API health endpoint is proxied at:

```bash
curl -fsS http://localhost:8080/api/health
```

Container logs (all services run under supervisord):

```bash
docker logs -f freeframe
docker exec freeframe supervisorctl status
```

### Troubleshooting

Login fails:

- Behind an HTTPS proxy: confirm `X-Forwarded-Proto` is forwarded and
  `FRONTEND_URL` / `CORS_ORIGINS` match the browser origin exactly.
- Plain HTTP on a LAN: works by default (the image ships `LOCAL_MODE=true`). If
  you set `LOCAL_MODE=false`, Secure-only cookies require HTTPS at your proxy.

Uploads fail:

- Confirm `FRONTEND_URL` matches the page origin exactly.
- If using external S3, confirm `S3_PUBLIC_ENDPOINT` is reachable from the
  browser and bucket CORS allows the `FRONTEND_URL` origin.
- Check transcoding logs: `docker exec freeframe supervisorctl tail worker`.

Port conflict:

```bash
sudo lsof -i :8080
```

Stop the other service or change the published port in `docker-compose.aio.yml`.
