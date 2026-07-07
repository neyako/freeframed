# freeframed All-In-One Image

This image is the primary deployment path for freeframed — built for a NAS, mini PC, or office
workstation: web, API, workers, Postgres, Redis, MinIO, nginx, and supervisor run in one container
with all state in a single bind mount. It is the only deployment path this fork ships; if you need
independently managed services, use mainline [FreeFrame](https://github.com/Techiebutler/freeframe).

## Get the image

Prebuilt (recommended — built by GitHub Actions on every push to main):

```bash
docker pull ghcr.io/neyako/freeframe:edge     # latest main
docker pull ghcr.io/neyako/freeframe:latest   # latest tagged release
```

Or build from source:

```bash
docker build -f Dockerfile.allinone -t freeframe:allinone .
```

The Dockerfile defaults to `linux/amd64` so the bundled Jellyfin ffmpeg build exposes the full
NVENC, QSV, and VAAPI encoder set required by the image smoke test. Other platforms can be built
with `--build-arg ALLINONE_PLATFORM=linux/arm64`, but hardware encoder availability may differ.

## Run

All state lives under `/data` — mount a host directory there (bind mount), so your
data sits in a normal folder you can back up, snapshot, or move. Compose users can
run `docker compose -f docker-compose.aio.yml up -d` from the repo root;
with plain `docker run`:

```bash
docker run -d --name freeframe -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

NVIDIA GPU hosts can add `--gpus all` when the NVIDIA Container Toolkit is installed:

```bash
docker run -d --name freeframe --gpus all -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

Intel or AMD GPU hosts can pass the DRM device:

```bash
docker run -d --name freeframe --device /dev/dri:/dev/dri -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

## Reverse proxy (optional)

The container serves everything on one plain-HTTP port — app, API, uploads, and video
segments all ride the same origin, so there is exactly one domain to proxy and no
separate S3/MinIO host. No proxy is required on a trusted LAN. To put it behind your
own proxy, forward to that port with websocket support and unlimited body size, and
set `FRONTEND_URL` and `CORS_ORIGINS` to the public origin.

Nginx Proxy Manager: add a Proxy Host → forward to `<host>:8080`, enable
"Websockets Support", and set client_max_body_size 0 under Advanced → Custom
Nginx Configuration.

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

```
review.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Then run the container with `-e FRONTEND_URL=https://review.example.com
-e CORS_ORIGINS=https://review.example.com`.

## Environment

Common overrides:

- `JWT_SECRET`: set this explicitly for production. If omitted, the container generates one and
  persists it in `/data/secrets.env`.
- `SETUP_TOKEN`: set this explicitly or read the generated value from `/data/secrets.env` before
  creating the first admin account.
- `FRONTEND_URL`: set this to the public origin, such as `https://photos.example.com`, so generated
  links point at the right host.
- `TRANSCODE_HWACCEL`: defaults to `auto`; set a specific backend only when troubleshooting host
  hardware support.
- `API_WORKERS`: FastAPI worker process count.
- `TRANSCODING_CONCURRENCY`: concurrent transcoding worker slots.

Example:

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

## Uploads & Object Storage

Media traffic (uploads, playback segments, thumbnails, downloads) is served on the same
origin as the app: presigned URLs are path-style (`/<bucket>/<key>?...`) and the bundled
nginx routes the bucket path to the internal MinIO. One port, one domain — nothing else
to publish or proxy. MinIO itself stays on `127.0.0.1:9000` inside the container.

`S3_PUBLIC_ENDPOINT` defaults to `FRONTEND_URL`, so the only rule is the one the app
already has: `FRONTEND_URL` must equal the origin users type into their browser, exactly
— scheme, host, and port. If uploads or video playback fail, a mismatched `FRONTEND_URL`
is the usual cause.

If default `minioadmin` credentials are present in local mode, the entrypoint replaces them with
random credentials persisted in `/data/secrets.env`. Outside local mode, startup refuses default
MinIO/S3 credentials.

To use external S3-compatible storage instead of the bundled MinIO, set `S3_PUBLIC_ENDPOINT`
to the browser-reachable origin of that service:

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

## Data And Backups

All persistent state lives under `/data`, including Postgres data, MinIO objects, Redis
AOF data, and the generated secret file. With a bind mount this is just a host directory —
back it up before upgrades and on a regular schedule. Because the database is bundled into the application container, this image is intended for
one machine and is not a horizontal-scaling topology.

## Encoder Verification

After the container is running, verify the bundled ffmpeg encoders:

```bash
docker exec freeframe /usr/local/bin/ffmpeg -hide_banner -encoders | grep h264
```

The default amd64 image should list `h264_nvenc`, `h264_qsv`, and `h264_vaapi`. Host GPU access
still depends on passing the matching runtime flag or device into `docker run`.
