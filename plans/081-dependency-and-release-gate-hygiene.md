# Plan 081: Patch vulnerable dependencies and give the release pipeline the same test gate as CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96b6644..HEAD -- apps/api/requirements.txt apps/api/requirements-dev.txt apps/web/package.json apps/web/pnpm-lock.yaml apps/api/Dockerfile .github/workflows/release.yml docs/contributing.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (one MED item: the Python 3.11→3.12 image bump — see Step 4)
- **Depends on**: none
- **Category**: security / dx
- **Planned at**: commit `96b6644`, 2026-07-12

## Why this matters

Four independent, small hygiene gaps: (1) `python-multipart==0.0.12` has 8
published advisories — including an arbitrary-file-write (GHSA-wp53-j4wj-2cfg,
fixed 0.0.22) and several parser DoS issues (fixed by 0.0.31) — and the API
uses it (FastAPI `Form(...)` params in `routers/projects.py` and
`routers/integrations.py`). (2) `fabric` resolves to 7.2.0 in the lockfile
while GHSA-w22m-hvvm-xmwx (SVG-serialization XSS) is fixed in 7.4.0, *inside*
the already-declared `^7.2.0` range — a lockfile refresh, no code change.
(3) CI tests on Python 3.12 but shipped images run 3.11 (`apps/api/Dockerfile`)
— code is verified on a version users never run. (4) `release.yml`'s test job
has no Postgres service and no `TEST_DATABASE_URL`, so every real-DB
integration test **silently skips** right before images are built and pushed;
it also lacks `ci.yml`'s anti-gutting tripwires. The release gate is strictly
weaker than the PR gate.

## Current state

Files:

- `apps/api/requirements.txt:10` — `python-multipart==0.0.12` (latest is 0.0.32).
- `apps/web/package.json:25` — `"fabric": "^7.2.0"`; `apps/web/pnpm-lock.yaml`
  resolves `fabric@7.2.0`.
- `apps/api/Dockerfile:1` — `FROM python:3.11-slim`.
- `.github/workflows/ci.yml:70` — `python-version: "3.12"`; its `backend-test`
  job declares a `services: postgres:` block (`postgres:15-alpine`, health
  checks, port 5432) and sets `TEST_DATABASE_URL`.
- `docs/contributing.md:20` — says "Python 3.11+".
- `.github/workflows/release.yml` — `test` job (lines ~16–40): sets a
  `DATABASE_URL` env var pointing at `localhost:5432` but declares **no
  `services:` block** and **no `TEST_DATABASE_URL`**; runs
  `python -m pytest apps/api/tests/ -q` with no minimum-pass tripwires.
- `apps/api/tests/integration/conftest.py` — auto-skips the entire
  `tests/integration/` directory when `TEST_DATABASE_URL` is unset.

`release.yml` test job today (excerpt):

```yaml
jobs:
  test:
    name: Test (release gate)
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://user:pass@localhost:5432/freeframe_test
      REDIS_URL: redis://localhost:6379/0
      ...
    steps:
      - uses: actions/checkout@v6
      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Install dependencies
        run: pip install -r apps/api/requirements-dev.txt
      - name: Run tests
        run: python -m pytest apps/api/tests/ -q
```

Conventions:

- pnpm ONLY — never `npm install` (a stray `package-lock.json` is a bug).
- CI has anti-gutting tripwires in `ci.yml` (critical-file existence checks,
  minimum test counts); if you rename/delete a listed file, update the
  tripwire in the same commit.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Refresh fabric in lockfile | `cd apps/web && pnpm update fabric` | `pnpm-lock.yaml` resolves fabric ≥7.4.0, <8 |
| Web tests | `cd apps/web && pnpm test` | all pass (~173) |
| Typecheck | `cd apps/web && pnpm exec tsc --noEmit` | 0 errors |
| Web build | `cd apps/web && pnpm build` | exit 0 |
| Audit spot-check | `cd apps/web && pnpm audit --prod` | no advisory for fabric |
| YAML validity | `ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml")'` | exit 0 (system python3 lacks PyYAML) |
| Py syntax | `python3 -m py_compile apps/api/main.py` | exit 0 |

No local Python venv exists — the requirements bump is verified by CI. Do NOT
run `pip install` into the system Python.

## Scope

**In scope**:

- `apps/api/requirements.txt` (and `requirements-dev.txt` if it also pins
  `python-multipart` — check)
- `apps/web/pnpm-lock.yaml` (via `pnpm update fabric` only)
- `apps/api/Dockerfile`
- `docs/contributing.md` (one line)
- `.github/workflows/release.yml`
- `plans/README.md` (status row)

**Out of scope**:

- `apps/web/package.json` — no range changes needed; fabric's fix is inside
  `^7.2.0`. Do not bump `next` here (that's plan 083's migration spike).
- `.github/workflows/ci.yml` — already correct; don't touch.
- `Dockerfile.allinone` — its Debian bookworm base ships Python 3.11 too, but
  changing the all-in-one base image needs a build+run smoke test that's out
  of this plan's budget; see Maintenance notes.
- Any other dependency bump (fastapi/pydantic/etc. are CVE-clean at their pins).

## Git workflow

- Branch: `advisor/081-dep-release-hygiene`
- Conventional commits, one per step, e.g.
  `fix(deps): bump python-multipart to 0.0.32`,
  `ci(release): run integration tests against real Postgres`.
- Do NOT push or merge; the maintainer merges.

## Steps

### Step 1: Bump python-multipart

In `apps/api/requirements.txt` change `python-multipart==0.0.12` →
`python-multipart==0.0.32`. Check `apps/api/requirements-dev.txt` for a
duplicate pin (`grep python-multipart apps/api/requirements-dev.txt`) and, if
present, change it identically (if it only `-r`-includes requirements.txt,
nothing to do).

**Verify**: `grep -rn "python-multipart" apps/api/` → every match says `0.0.32`.

### Step 2: Refresh fabric in the lockfile

`cd apps/web && pnpm update fabric`

**Verify**: `grep -A1 "fabric@" apps/web/pnpm-lock.yaml | head -5` shows a
7.4.x-or-later version; `pnpm audit --prod` no longer lists
GHSA-w22m-hvvm-xmwx; then `pnpm test` → all pass, `pnpm exec tsc --noEmit` →
0 errors, `pnpm build` → exit 0 (fabric powers the annotation canvas — the
existing tests cover the drawing hooks).

### Step 3: Align the API image on Python 3.12

In `apps/api/Dockerfile` change `FROM python:3.11-slim` →
`FROM python:3.12-slim`. In `docs/contributing.md:20` change "Python 3.11+"
→ "Python 3.12".

**Verify**: `grep -n "3.11" apps/api/Dockerfile docs/contributing.md` → no
matches. If Docker is available:
`docker build -f apps/api/Dockerfile -t ff-api-test apps/api` → exit 0
(if Docker is not available, note that in your report; CI builds it).

### Step 4: Give release.yml a real DB and tripwires

Edit `.github/workflows/release.yml`'s `test` job:

1. Add the `services:` block copied verbatim from `ci.yml`'s `backend-test`
   job (`postgres:15-alpine`, same env, ports, health options).
2. Add `TEST_DATABASE_URL: postgresql://user:pass@localhost:5432/freeframe_test`
   to the job `env:` (alongside the existing `DATABASE_URL`).
3. Change the test step to fail on a suspiciously small pass count, mirroring
   ci.yml's tripwire intent. Use ci.yml's own mechanism if it has one for the
   backend job (check `ci.yml` first and copy it); otherwise:

```yaml
      - name: Run tests
        run: |
          python -m pytest apps/api/tests/ -q 2>&1 | tee test-output.txt
          test ${PIPESTATUS[0]} -eq 0
          PASSED=$(grep -oE '[0-9]+ passed' test-output.txt | grep -oE '[0-9]+' | head -1)
          echo "passed=$PASSED"
          test "${PASSED:-0}" -ge 100
```

(The current suite is well above 100 passing tests including integration;
the floor catches a gutted or mass-skipped suite, not normal variance.)

**Verify**: `ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml")'`
→ exit 0; `grep -n "TEST_DATABASE_URL\|postgres:15-alpine" .github/workflows/release.yml`
→ both present in the `test` job.

## Test plan

No new test files. The gate IS the deliverable: after this lands, a release
run executes the ~37-file integration suite against real Postgres before any
image is pushed. Existing web tests (`pnpm test`) verify the fabric refresh.

## Done criteria

- [ ] `grep -rn "0.0.12" apps/api/requirements*.txt` → no matches
- [ ] lockfile resolves fabric ≥7.4.0; `pnpm audit --prod` clean of the fabric advisory
- [ ] `cd apps/web && pnpm test && pnpm exec tsc --noEmit && pnpm build` all exit 0
- [ ] `grep -n "python:3.12-slim" apps/api/Dockerfile` → 1 match
- [ ] release.yml has `services: postgres` + `TEST_DATABASE_URL` + a pass-count floor
- [ ] `git status` clean outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm update fabric` wants to change anything besides fabric entries in the
  lockfile (transitive fabric deps are fine; unrelated packages are not).
- Web tests fail after the fabric refresh (7.2→7.4 should be non-breaking; a
  failure means the annotation code hit a real behavior change — report it).
- `python-multipart` 0.0.32 is yanked/unavailable — pin the newest available
  ≥0.0.31 and note the substitution.
- release.yml's structure differs materially from the excerpt (e.g. the test
  job was already fixed).

## Maintenance notes

- **Deferred deliberately**: `Dockerfile.allinone` also runs Python 3.11 (Debian
  bookworm's apt python3). Aligning it means either a base-image change or a
  deadsnakes/pyenv install — do it in a plan that includes the all-in-one
  build+run smoke test. Until then the version skew persists only for the
  all-in-one image.
- Reviewer: check the pass-count floor number against the actual CI run —
  if the suite legitimately shrinks below the floor someday, the floor must
  move in the same PR (that's the tripwire working as designed).
- Dependabot: `.github/dependabot.yml` exists in path-ignores — check whether
  it actually covers pip + npm ecosystems; if not, enabling it would make this
  plan's class of finding automatic. Not done here.
