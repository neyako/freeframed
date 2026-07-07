# Architecture Overview

This document explains how freeframed's components work together. freeframed is
a NAS-first fork of [FreeFrame](https://github.com/Techiebutler/freeframe), with
the all-in-one single-box deployment treated as the primary topology.

---

## System Overview

freeframed is a monorepo with two main applications and supporting
infrastructure. The default all-in-one image runs everything on one machine:

```
Browser / optional LAN reverse proxy
    │
    ▼
nginx in all-in-one container (:80, published as :8080 by docker-compose.aio.yml)
    ├── /          → Next.js web server (127.0.0.1:3000)
    ├── /<bucket>/ → MinIO (127.0.0.1:9000) — same-origin presigned media URLs
    └── /api/      → FastAPI backend (127.0.0.1:8000) ── SSE ──▶ Clients
                    │
                    ├── PostgreSQL (127.0.0.1:5432)
                    ├── Redis (127.0.0.1:6379)
                    ├── MinIO (127.0.0.1:9000)
                    └── Celery workers for transcoding, email, and beat
```

| Component | Role |
|-----------|------|
| **nginx** | Routes `/api/*` to FastAPI and `/` to Next.js; TLS is handled by an optional external proxy |
| **Next.js** | Server-rendered frontend, handles UI, auth cookies, client-side media playback |
| **FastAPI** | REST API, auth, business logic, SSE events, S3 presigned URLs |
| **PostgreSQL** | Primary datastore for all entities (users, projects, assets, comments, etc.) |
| **Redis** | Message broker for Celery task queues, magic code TTL storage |
| **MinIO / S3 Storage** | Stores originals, transcoded outputs, and thumbnails |
| **Transcoding Workers** | Celery workers that process video/audio/image files via FFmpeg |
| **Email Workers** | Celery workers that send transactional emails (invites, magic codes, notifications) |

This fork ships only the all-in-one topology (plus the multi-service dev
compose for local development). SaaS, multi-tenant, and larger production-house
architecture work should target mainline FreeFrame instead of this fork.

---

## Data Flow

### Upload and Processing

```
User uploads file
    │
    ▼
Frontend initiates multipart upload
    │
    ▼
API creates presigned URLs ──▶ Frontend uploads chunks directly to S3
    │
    ▼
Frontend calls /upload/complete
    │
    ▼
API dispatches Celery task ──▶ Worker downloads from S3
    │                              │
    ▼                              ▼
API sends SSE: transcode_progress  FFmpeg processes file
    │                              │
    ▼                              ▼
API sends SSE: transcode_complete  Worker uploads outputs to S3
```

### Review and Approval

```
Reviewer opens asset
    │
    ▼
Frontend loads HLS stream (video) / WebP (image) / MP3 (audio)
    │
    ▼
Reviewer adds comment (with optional timecode + drawing annotation)
    │
    ▼
API saves comment ──▶ SSE: new_comment ──▶ Other viewers see it instantly
    │
    ▼
Reviewer approves / rejects ──▶ SSE: approval_updated
```

---

## Media Processing Pipeline

### Video

1. Raw file uploaded to S3 via presigned multipart upload
2. Celery worker reads directly from S3 presigned URL (no full download)
3. `ffprobe` extracts metadata (duration, resolution, FPS)
4. FFmpeg generates multi-bitrate HLS:
   - 1080p (CRF 20), 720p (CRF 22), 360p (CRF 26)
   - 2-second segments with forced keyframes
5. Thumbnails generated (1 per 10 seconds)
6. Waveform JSON generated for audio track
7. All outputs uploaded to S3 at `hls/{project_id}/{version_id}/`
8. Asset status set to `ready`, SSE event fired

### Audio

1. Raw file (MP3, WAV, FLAC, AAC) uploaded to S3
2. Worker normalizes audio and converts to MP3
3. Waveform JSON generated for visualization
4. Outputs uploaded to S3

### Image

1. Raw file (JPEG, PNG, HEIC, TIFF) uploaded to S3
2. Worker converts to optimized WebP + generates thumbnail
3. For **carousels**: each image processed independently with sequence ordering

---

## Permission Model

Enforced asset access is project-scoped. Organization/team tables and
`shared_with_team_id` remnants still exist in migrations/API edges, but
`can_access_asset` does not grant access through a team or org-admin path.
Clean up those remnants in a separate API plan.

```
Project
├── owner    ── full control over project
├── editor   ── upload, edit assets
├── reviewer ── comment, approve/reject
└── viewer   ── read-only access
    │
    Share Link
    ├── approve  ── can approve/reject
    ├── comment  ── can add comments
    └── view     ── read-only
```

**Asset access is checked in this order:**
1. Is the user the asset creator?
2. Is the user a project member (any role)?
3. Was the asset shared directly with the user (`AssetShare`)?
4. Is the project public (`Project.is_public`)? Any authenticated user can view.

Guest users (via share links) use the `GuestUser` table — they provide email + name only, no account required.

---

## Real-Time Updates (SSE)

freeframed uses **Server-Sent Events** (not WebSockets) for real-time updates. A single SSE endpoint per project streams all events:

```
GET /events/{project_id}
```

Event types:

| Event | Payload | When |
|-------|---------|------|
| `transcode_progress` | `{asset_id, percent}` | During video processing |
| `transcode_complete` | `{asset_id, version_id}` | Processing finished |
| `transcode_failed` | `{asset_id, error}` | Processing failed |
| `new_comment` | `{asset_id, comment_id, author}` | Comment posted |
| `comment_resolved` | `{comment_id}` | Comment marked resolved |
| `approval_updated` | `{asset_id, user_id, status}` | Approval status changed |

Clients reconnect automatically on disconnect. SSE was chosen over WebSockets because it's simpler, works through most proxies, and is sufficient for an async review workflow.

---

## Database

All tables use **soft delete** (`deleted_at` column). Records are never hard-deleted in application code.

Key entity relationships:

```
Projects ──── ProjectMembers
    │
    ├── Folders
    ├── Assets ──┬── AssetVersions ──── MediaFiles
    │            ├── Comments ──┬── Annotations
    │            │              ├── Attachments
    │            │              └── Reactions
    │            ├── Approvals
    │            └── AssetShares
    └── Collections
```

**ORM:** SQLAlchemy 2.0 with Alembic for migrations.
