# freeframed

**Homelab-first media review for individual creators and small teams.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](docker-compose.aio.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](docs/contributing.md)

freeframed is a fork of [FreeFrame](https://github.com/Techiebutler/freeframe), tuned for
individual creators and small teams who want to self-host media review on a NAS,
mini PC, or office workstation. The default deployment is one container, one bind
mount, and low operational overhead.

This fork is not aimed at SaaS, multi-tenant, or production-house team
deployments. If that is the direction you want, use or contribute to mainline
[FreeFrame](https://github.com/Techiebutler/freeframe).

---

## Features

- **Single-box install** for a NAS or small home/office server
- **Video review** with HLS playback and timecoded comments
- **Image and audio review** with annotations and waveform visualization
- **Drawing annotations** on frames and stills
- **Threaded comments** with mentions, reactions, and attachments
- **Version management** for client notes and creator revisions
- **Folders and projects** without needing a full production-management stack
- **Private share links** for reviewers, including guest commenting
- **Due dates and email reminders** for small-team follow-up
- **Server-Sent Events** for live review updates without WebSocket complexity

## Quick Start: NAS / All-In-One

The primary deployment path is [`docker-compose.aio.yml`](docker-compose.aio.yml)
and [`deploy/allinone`](deploy/allinone/README.md). It runs the web UI, API,
workers, PostgreSQL, Redis, MinIO, nginx, and supervisor in one container. All
state lives in a bind mount.

**Prerequisites:** Docker and Docker Compose.

```bash
git clone https://github.com/neyako/freeframed.git
cd freeframed
docker compose -f docker-compose.aio.yml up -d
```

Open `http://<host>:8080`. The first-admin `SETUP_TOKEN` is generated in
`./data/secrets.env` by the default compose bind mount.

Plain Docker works too:

```bash
docker run -d --name freeframe -p 8080:80 -v /srv/freeframe:/data ghcr.io/neyako/freeframe:edge
```

Reverse proxy is optional on a trusted LAN. If you put nginx, Nginx Proxy
Manager, Caddy, or another proxy in front, forward it to port `8080` and set
`FRONTEND_URL` and `CORS_ORIGINS` to the public origin.

See [deploy/allinone/README.md](deploy/allinone/README.md) for GPU flags,
reverse proxy examples, backups, and object-storage notes.

Full deployment details are in [docs/deployment.md](docs/deployment.md). If you
need a multi-container stack with separately managed services, use mainline
[FreeFrame](https://github.com/Techiebutler/freeframe) — this fork ships only
the all-in-one path.

## Development

```bash
git clone https://github.com/neyako/freeframed.git
cd freeframed
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Open [http://localhost:3000](http://localhost:3000). Development services:

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
| MinIO | http://localhost:9000 |
| MinIO Console | http://localhost:9001 |
| PostgreSQL | localhost:5433 |

## Architecture

```
Browser
  │
  ▼
nginx :80 in container, usually published as host :8080
  ├── /          → Next.js web server on 127.0.0.1:3000
  ├── /<bucket>/ → MinIO on 127.0.0.1:9000 (same-origin presigned media URLs)
  └── /api/      → FastAPI on 127.0.0.1:8000
                │
                ├── PostgreSQL on 127.0.0.1:5432
                ├── Redis on 127.0.0.1:6379
                ├── MinIO on 127.0.0.1:9000
                └── Celery workers for transcoding and email
```

## Tech Stack

| Component    | Technology                                       |
|--------------|--------------------------------------------------|
| Frontend     | Next.js 14, React 18, Tailwind CSS, Zustand      |
| Backend      | FastAPI, SQLAlchemy, Pydantic                    |
| Database     | PostgreSQL 15                                     |
| Queue        | Celery + Redis                                    |
| Transcoding  | FFmpeg (multi-bitrate HLS)                        |
| Storage      | MinIO in all-in-one, or any S3-compatible service |
| Proxy        | nginx in the container; bring your own TLS proxy  |
| Auth         | JWT + magic code email login                      |

## Documentation

| Guide | Description |
|-------|-------------|
| [Deployment](docs/deployment.md) | NAS all-in-one setup, proxy, storage, backups |
| [Architecture](docs/architecture.md) | System design, data flow, media pipeline, permissions |
| [Contributing](docs/contributing.md) | Dev setup, testing, code style, PR process |
| [Environment Variables](.env.example) | Full config reference with comments |

## Contributing

Contributions that improve the single-box creator workflow belong here. Work
aimed at SaaS, multi-tenant, or production-house deployments belongs upstream in
[FreeFrame](https://github.com/Techiebutler/freeframe). See
[docs/contributing.md](docs/contributing.md).

## License

MIT License — see [LICENSE](LICENSE) for details.
