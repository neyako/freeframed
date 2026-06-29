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
