# Plan 010: CI/CD — publish container images to GHCR on release (test-gated), build all-in-one in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- .github/workflows/ci.yml`
> If `ci.yml` changed since this plan was written, compare the "Current state"
> excerpt against the live file before editing; on a mismatch, treat it as a
> STOP condition. `.github/workflows/release.yml` is **created** by this plan —
> if it already exists, STOP and report.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adds a workflow + one CI step; no app code, no change to existing CI jobs' logic)
- **Depends on**: plans/009-all-in-one-docker-image.md (the release workflow builds & pushes
  `Dockerfile.allinone`; that file must exist). The api/web image publish steps work independently of
  009.
- **Category**: dx / migration (release automation)
- **Planned at**: commit `c6eb4db`, 2026-06-29

## Why this matters

CI today (`.github/workflows/ci.yml`) tests the backend, builds the frontend, lints, and **builds**
the Docker images — but nothing is ever **published**. There's no release pipeline: shipping a new
version means someone building and pushing images by hand, off an untested local tree. This plan adds
the **CD half**: a `release.yml` that, when a `v*` git tag is pushed, runs the test suite and — only
if it passes — builds and pushes versioned images to the GitHub Container Registry (GHCR):
`freeframe` (the all-in-one image from Plan 009), `freeframe-api`, and `freeframe-web`. It also
extends CI so the all-in-one image is built on every PR (catching `Dockerfile.allinone` breakage
before it reaches a release). After this, cutting a release is `git tag v1.x.y && git push --tags`,
and operators `docker pull ghcr.io/<owner>/freeframe:1.x.y`.

## Current state

### `.github/workflows/ci.yml` — CI exists, no CD

Jobs: `backend-test` (pytest, asserts ≥40 pass), `frontend-build`, `lint`, `docker-build`. The
`backend-test` job sets these env vars and runs without service containers (the suite is
self-contained):

```yaml
    env:
      DATABASE_URL: postgresql://user:pass@localhost:5432/freeframe_test
      REDIS_URL: redis://localhost:6379/0
      S3_BUCKET: freeframe-test
      S3_ENDPOINT: http://localhost:9000
      S3_ACCESS_KEY: testkey
      S3_SECRET_KEY: testsecret
      S3_REGION: us-east-1
      JWT_SECRET: ci-test-secret-key-not-for-production
      FRONTEND_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v6
      - name: Set up Python
        uses: actions/setup-python@v6
        with: { python-version: "3.12", cache: pip, cache-dependency-path: apps/api/requirements.txt }
      - name: Install dependencies
        run: pip install -r apps/api/requirements.txt
      ...
      - name: Run tests
        run: python -m pytest apps/api/tests/ -v --tb=short ...
```

The `docker-build` job (its tail) — this is the anchor you will extend:

```yaml
      - name: Verify docker-compose syntax
        run: |
          python3 -c "import yaml; yaml.safe_load(open('docker-compose.dev.yml'))" && echo "Dev compose YAML is valid"
          python3 -c "import yaml; yaml.safe_load(open('docker-compose.prod.yml'))" && echo "Prod compose YAML is valid"
```

Action versions in use (match them for consistency): `actions/checkout@v6`,
`actions/setup-python@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`.

### Repo facts

- This is a GitHub repo (it has `.github/workflows/` and a CI workflow). GHCR is the natural registry
  (`ghcr.io`), authenticated with the built-in `GITHUB_TOKEN` (no extra secret needed) given
  `permissions: packages: write`.
- Images to publish: `Dockerfile.allinone` (Plan 009, the headline), `apps/api/Dockerfile.prod`,
  `apps/web/Dockerfile.prod`. The web prod image builds from the `apps/web` context.

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`) | Expected |
|---------|-------------------------------------------|----------|
| Validate release workflow YAML | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` | exit 0 |
| Validate CI workflow YAML | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` | exit 0 |
| Lint workflows (if available) | `actionlint` | no errors (skip if not installed) |

The workflow cannot be executed locally — it runs on GitHub on a tag push. Verification is YAML
validity + structural greps + (optionally) `actionlint`. State clearly in your report that the
end-to-end publish is exercised only by an actual tag push.

## Scope

**In scope**:
- `.github/workflows/release.yml` (create) — test-gated build & push to GHCR on `v*` tags.
- `.github/workflows/ci.yml` — add ONE step to the existing `docker-build` job: build (no push) the
  all-in-one image. Do not alter any other job or step.

**Out of scope** (do NOT touch):
- Application code, Dockerfiles, compose files.
- The existing `backend-test` / `frontend-build` / `lint` jobs' logic — leave them exactly as they
  are (the release workflow has its own lean test job; do not refactor CI into reusable workflows in
  this plan).
- Any registry other than GHCR; any secret beyond the built-in `GITHUB_TOKEN`.

## Git workflow

- Branch: `advisor/010-cicd-release-pipeline`
- Conventional commits (e.g. `ci: publish images to GHCR on release`).
- Do NOT push or open a PR unless instructed. (Do NOT push tags — that would trigger a real publish.)

## Steps

### Step 1: Create `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  # ── Gate: never publish a failing tree ──────────────────────────────────────
  test:
    name: Test (release gate)
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://user:pass@localhost:5432/freeframe_test
      REDIS_URL: redis://localhost:6379/0
      S3_BUCKET: freeframe-test
      S3_ENDPOINT: http://localhost:9000
      S3_ACCESS_KEY: testkey
      S3_SECRET_KEY: testsecret
      S3_REGION: us-east-1
      JWT_SECRET: ci-test-secret-key-not-for-production
      FRONTEND_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v6
      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: apps/api/requirements.txt
      - name: Install dependencies
        run: pip install -r apps/api/requirements.txt
      - name: Run tests
        run: python -m pytest apps/api/tests/ -q

  # ── Build & push images to GHCR ─────────────────────────────────────────────
  publish:
    name: Build & push images
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v6

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # All-in-one image (Plan 009) — the headline artifact.
      - name: Metadata (all-in-one)
        id: meta_allinone
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/freeframe
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - name: Build & push all-in-one
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.allinone
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta_allinone.outputs.tags }}
          labels: ${{ steps.meta_allinone.outputs.labels }}

      # API image
      - name: Metadata (api)
        id: meta_api
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/freeframe-api
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - name: Build & push api
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/api/Dockerfile.prod
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta_api.outputs.tags }}
          labels: ${{ steps.meta_api.outputs.labels }}

      # Web image (built from the apps/web context)
      - name: Metadata (web)
        id: meta_web
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/freeframe-web
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - name: Build & push web
        uses: docker/build-push-action@v6
        with:
          context: apps/web
          file: apps/web/Dockerfile.prod
          build-args: |
            NEXT_PUBLIC_API_URL=/api
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta_web.outputs.tags }}
          labels: ${{ steps.meta_web.outputs.labels }}
```

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` → exit 0.

### Step 2: Extend CI to build the all-in-one image on PRs

In `.github/workflows/ci.yml`, in the `docker-build` job, add a step **after** the existing
"Verify docker-compose syntax" step (the last step in that job):

```yaml
      - name: Build all-in-one image (no push)
        run: docker build -f Dockerfile.allinone -t freeframe-allinone:ci .
```

Change nothing else in `ci.yml`.

**Verify**:
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0
- `grep -n "Build all-in-one image (no push)" .github/workflows/ci.yml` → one match

### Step 3: Structural checks

**Verify** (all should match):
- `grep -n "tags:" .github/workflows/release.yml | head -1` and confirm the `on.push.tags` includes
  `"v*"` (read the file to confirm the trigger).
- `grep -n "ghcr.io/\${{ github.repository_owner }}/freeframe" .github/workflows/release.yml` → ≥3 matches (allinone/api/web).
- `grep -n "needs: test" .github/workflows/release.yml` → one match (publish is gated by tests).
- `grep -n "packages: write" .github/workflows/release.yml` → one match.

## Test plan

No executable test harness for GitHub workflows; verification is YAML validity + the structural
greps above + (if installed) `actionlint .github/workflows/release.yml`. The real end-to-end run is
exercised only when a maintainer pushes a `v*` tag — call this out explicitly in your report. If
`actionlint` is available in your environment, run it and report results; if not, say so.

Optional (only if you can, and ONLY in your disposable worktree, never pushing): a local
`act`-based dry run is acceptable but not required; do not attempt anything that pushes to GHCR.

## Done criteria

ALL must hold:

- [ ] `.github/workflows/release.yml` exists and is valid YAML (`yaml.safe_load` exits 0)
- [ ] `.github/workflows/ci.yml` is valid YAML and contains the new "Build all-in-one image (no push)" step
- [ ] `grep -n "needs: test" .github/workflows/release.yml` → match (publish gated on tests)
- [ ] `grep -n "packages: write" .github/workflows/release.yml` → match
- [ ] `grep -c "docker/build-push-action@v6" .github/workflows/release.yml` → `3` (allinone + api + web)
- [ ] The release workflow triggers on `v*` tags (confirmed by reading `on.push.tags`)
- [ ] No files outside `.github/workflows/` modified (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `Dockerfile.allinone` does not exist (Plan 009 hasn't landed) — the release build and the CI step
  would both fail. Do Plan 009 first, or (if explicitly asked to ship CD before 009) drop the
  all-in-one build/push and CI step and note the gap.
- `.github/workflows/ci.yml`'s `docker-build` job no longer ends with the "Verify docker-compose
  syntax" step (the anchor moved) — report what you found instead of guessing where to add the step.
- `apps/web/Dockerfile.prod` is built from a different context than `apps/web` (the web publish
  `context`/`file` would be wrong) — verify against the live `docker-compose.prod.yml` `web.build`.
- `actionlint` (if you run it) reports a hard error in the new workflow — fix or report.

## Maintenance notes

- **Versioning**: tags drive image versions via `docker/metadata-action` (`{{version}}`,
  `{{major}}.{{minor}}`, `latest`). Use semver tags (`v1.4.2`). A pre-release scheme (e.g. `-rc`)
  would need a `type=semver` pattern tweak.
- **amd64 only**: hardware encoders (NVENC/QSV/VAAPI), jellyfin-ffmpeg, and the MinIO binary pulled
  in Plan 009 are linux-amd64. Adding `linux/arm64` would require an arm64 ffmpeg/MinIO story — a
  deliberate follow-up, not a free `platforms:` addition.
- **GHCR visibility**: the first publish creates the packages as private by default; the maintainer
  flips them to public in the repo's Packages settings if they want anonymous `docker pull`.
- **Gate**: `publish` `needs: test`, so a red test suite blocks the release. Keep the release test job
  in sync with `ci.yml`'s env block if the suite's required env changes.
- Reviewer should scrutinise: no registry credentials are hard-coded (only the built-in
  `GITHUB_TOKEN`), `permissions:` is scoped to `packages: write` on the publish job only, and the CI
  all-in-one build is `no push` (build-only) so PRs never publish.
