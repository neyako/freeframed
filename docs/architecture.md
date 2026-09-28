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
| **Email Workers** | Celery workers that send transactional emails (invites, password resets, mentions, approvals) |

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
3. `ffprobe` extracts metadata (duration, display resolution incl. phone
   rotation, FPS, whether there is an audio track)
4. FFmpeg generates multi-bitrate HLS:
   - 1080p (CRF 20), 720p (CRF 22), 360p (CRF 26), sized by the frame's
     short edge so vertical 9:16 keeps full resolution; never upscaled
   - 2-second segments with forced keyframes; video-only when there's no audio
5. One thumbnail (best effort; a failure doesn't fail the transcode)
6. All outputs uploaded to S3 at `processed/{project_id}/{asset_id}/{version_id}/`
7. Version status set to `ready`, SSE event fired. Failures retry 3 times
   before the version is marked `failed`; versions stuck uploading/processing
   for a day are failed by the nightly `fail_stale_versions` task

### Audio

1. Raw file (MP3, WAV, FLAC, AAC) uploaded to S3
2. Worker normalizes audio and converts to MP3
3. Output uploaded to S3 (the web draws the waveform client-side)

### Image

1. Raw file (JPEG, PNG, HEIC, TIFF) uploaded to S3
2. Worker converts to optimized WebP + generates thumbnail

Downloads always serve the original upload, never the processed copy.

---

## Permission Model

freeframed has three kinds of people:

- **Owner**: the superadmin created at first setup. Passes every project check.
- **Editor**: an invited account added to a project. Uploads, adds versions,
  comments, approves, and manages share links.
- **Guests**: brands and clients who open an asset or folder share link. No account.

```
Project
├── owner    ── everything, plus members, settings, delete, empty trash
└── editor   ── upload, versions, comments, approvals, share links
    │
    Share Link (one asset or one folder)
    ├── approve  ── can approve/reject (secure links only)
    ├── comment  ── can add comments
    └── view     ── read-only
```

Account holders reach a project only through `ProjectMember` (or superadmin).
Every member can read, comment on, and approve every asset in the project
(`can_access_asset`). There are no public projects and no per-user direct shares.

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
    │            └── ShareLinks (asset)
    └── Folders ──── ShareLinks (folder)
```

**ORM:** SQLAlchemy 2.0 with Alembic for migrations.
