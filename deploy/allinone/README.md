# FreeFrame All-In-One Image

This image is the single-box deployment path for FreeFrame: web, API, workers, Postgres, Redis,
MinIO, nginx, and supervisor run in one container. Use the multi-container deployment when you need
horizontal scaling or independently managed stateful services.

## Build

```bash
docker build -f Dockerfile.allinone -t freeframe:allinone .
```

The Dockerfile defaults to `linux/amd64` so the bundled Jellyfin ffmpeg build exposes the full
NVENC, QSV, and VAAPI encoder set required by the image smoke test. Other platforms can be built
with `--build-arg ALLINONE_PLATFORM=linux/arm64`, but hardware encoder availability may differ.

## Run

CPU-only:

```bash
docker run -d --name freeframe -p 80:80 -v ff_data:/data freeframe:allinone
```

NVIDIA GPU hosts can add `--gpus all` when the NVIDIA Container Toolkit is installed:

```bash
docker run -d --name freeframe --gpus all -p 80:80 -v ff_data:/data freeframe:allinone
```

Intel or AMD GPU hosts can pass the DRM device:

```bash
docker run -d --name freeframe --device /dev/dri:/dev/dri -p 80:80 -v ff_data:/data freeframe:allinone
```

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
  -v ff_data:/data \
  -e JWT_SECRET='replace-with-a-long-random-secret' \
  -e FRONTEND_URL='https://photos.example.com' \
  -e TRANSCODE_HWACCEL=auto \
  -e API_WORKERS=4 \
  -e TRANSCODING_CONCURRENCY=2 \
  freeframe:allinone
```

## Uploads & Object Storage

The bundled MinIO service listens on `127.0.0.1:9000` inside the container and is not published by
default. For production, use an external S3-compatible endpoint and set `S3_PUBLIC_ENDPOINT` to the
browser-reachable HTTPS origin for presigned uploads and downloads.

For local-only testing you may publish MinIO with `-e MINIO_ADDRESS=0.0.0.0:9000
-p 127.0.0.1:9000:9000` and keep `S3_PUBLIC_ENDPOINT=http://localhost:9000`. Do not expose
MinIO on a public interface.

If default `minioadmin` credentials are present in local mode, the entrypoint replaces them with
random credentials persisted in `/data/secrets.env`. Outside local mode, startup refuses default
MinIO/S3 credentials.

Bucket CORS is derived from `FRONTEND_URL`. The browser's page origin must equal `FRONTEND_URL`
exactly, including scheme, host, and port. For local testing on a non-default port, use
`-e FRONTEND_URL=http://localhost:8080`. If uploads fail with `Failed to fetch`, a `FRONTEND_URL` that
does not match the page origin, or an unpublished port 9000, is the usual cause.

Remote host example:

```bash
docker run -d --name freeframe \
  -p 80:80 \
  -e FRONTEND_URL='https://review.example.com' \
  -e S3_STORAGE='s3' \
  -e S3_ENDPOINT='https://s3.example.com' \
  -e S3_PUBLIC_ENDPOINT='https://s3.example.com' \
  -e S3_ACCESS_KEY='replace-with-a-random-access-key' \
  -e S3_SECRET_KEY='replace-with-a-long-random-secret' \
  -v ff_data:/data \
  freeframe:allinone
```

## Data And Backups

All persistent state lives under the `/data` volume, including Postgres data, MinIO objects, Redis
AOF data, and the generated secret file. Back up the volume before upgrades and on a regular
schedule. Because the database is bundled into the application container, this image is intended for
one machine and is not a horizontal-scaling topology.

## Encoder Verification

After the container is running, verify the bundled ffmpeg encoders:

```bash
docker exec freeframe /usr/local/bin/ffmpeg -hide_banner -encoders | grep h264
```

The default amd64 image should list `h264_nvenc`, `h264_qsv`, and `h264_vaapi`. Host GPU access
still depends on passing the matching runtime flag or device into `docker run`.
