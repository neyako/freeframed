# Plan 026: Restore a green web test/type baseline (apps/web)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9f7b40b..HEAD -- apps/web/components/projects/__tests__/asset-grid.test.tsx apps/web/lib/__tests__/api.test.ts apps/web/stores/__tests__/notification-store.test.ts apps/web/test/setup.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / test-infra
- **Planned at**: commit `9f7b40b`, 2026-07-01

## Why this matters

`apps/web` has a **red baseline**: `tsc` reports a type error and `pnpm test`
fails 12 of 123 tests. This is not caused by any one feature — the web vitest
suite **is never run in CI** (`.github/workflows/ci.yml` has no `pnpm test`
step), and the CI typecheck step is `continue-on-error: true` (ci.yml:156), so
the suite silently rotted as product code evolved past its tests. The cost is
real: every plan whose done-criteria says "tests green / typecheck clean" is
**unsatisfiable on this baseline**, so executors either loop or wrongly mark
themselves blocked (this happened on plans 021 and 022). This plan makes the
baseline green so that gate means something again.

Three of the four failure clusters are real and version-independent (they fail
on CI's Node 20 too); the fourth (localStorage) only fails on Node ≥ 22 because
of Node's built-in Web Storage global colliding with jsdom. All four are fixed
on the **test side** — no product runtime behavior changes.

> **Tooling note — the `tsc` shim trap.** On a developer machine with a
> *globally-installed* `tsc` package, `npx tsc` and `pnpm exec tsc` resolve that
> global joke shim ("This is not the tsc command you are looking for", exit 1)
> instead of TypeScript. Always typecheck with the project-local binary:
> **`cd apps/web && ./node_modules/.bin/tsc --noEmit`**. (Clean CI has no global
> shim, so its `pnpm exec tsc` resolves the real compiler — but use the explicit
> path here so the result is unambiguous.)

## Current state

Run from `apps/web`:

```
$ ./node_modules/.bin/tsc --noEmit
components/projects/__tests__/asset-grid.test.tsx(57,3): error TS2322: Type '"uploaded"' is not assignable to type 'AssetStatus'.

$ pnpm test
 Test Files  3 failed | 13 passed (16)
      Tests  12 failed | 111 passed (123)
```

### Cluster A — asset-grid type error (1 type error; fails everywhere)

`apps/web/types/index.ts:5`:

```ts
export type AssetStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";
```

`apps/web/components/projects/__tests__/asset-grid.test.tsx:52-63` builds an
`Asset` fixture with `status: 'uploaded'` (line 57) — not a member of
`AssetStatus`. The **fixture is wrong**; the union is correct. Do not widen the
product type to accept `'uploaded'`.

### Cluster B — api.test.ts fetch mocks missing `.text()` (3 tests; fails everywhere)

`apps/web/lib/api.ts:89-94` reads the body via `response.text()` then
`JSON.parse`:

```ts
const text = await response.text()
if (!text) return undefined as unknown as T
return JSON.parse(text) as T
```

The success-path fetch mocks in `apps/web/lib/__tests__/api.test.ts` only stub
`json:` (lines 19-26, 34-41, 85-92), so `response.text()` is `undefined` →
`TypeError: response.text is not a function`. The **mocks are stale**; `api.ts`
is correct. (The "throws ApiError" and "204 No Content" tests pass — they never
reach line 89.)

### Cluster C — notification-store.test.ts uses the wrong verb/paths (2 tests; fails everywhere)

`apps/web/stores/notification-store.ts` calls **`api.post`** with `/me/...`
paths:

```ts
markAsRead:  await api.post(`/me/notifications/${id}/read`)   // line 32
markAllRead: await api.post('/me/notifications/read-all')     // line 43
```

But `apps/web/stores/__tests__/notification-store.test.ts` mocks
`api: { get, patch }` (lines 5-10) and asserts `api.patch('/notifications/read-all', {})`
etc. → `TypeError: api.post is not a function`. The **test is stale**; the store
is the product — update the test to match it.

### Cluster D — localStorage on Node ≥ 22 (7 tests; Node-25-local only)

`apps/web/vitest.config.ts` is correct: `environment: 'jsdom'`,
`setupFiles: ['./test/setup.ts']`, `globals: true`. On CI (Node 20) jsdom
provides `window.localStorage` and `apps/web/lib/__tests__/auth.test.ts` passes.
On **Node ≥ 22** (this machine: v25) Node ships a built-in global `localStorage`
that warns `--localstorage-file was provided without a valid path` and shadows
jsdom's, so `localStorage.clear()` (auth.test.ts:6) throws
`TypeError: localStorage.clear is not a function`. Fix by installing a
deterministic in-memory `localStorage` in the shared setup file so the suite is
identical across Node versions.

## Commands you will need

| Purpose   | Command                                          | Expected on success      |
|-----------|--------------------------------------------------|--------------------------|
| Install   | `pnpm install`                                   | exit 0                   |
| Typecheck | `cd apps/web && ./node_modules/.bin/tsc --noEmit`| exit 0, no errors        |
| Lint      | `cd apps/web && pnpm lint`                        | exit 0                   |
| Tests     | `cd apps/web && pnpm test`                        | 123 passed, exit 0       |
| One file  | `cd apps/web && pnpm test <path-or-substring>`   | that file green          |

Do **not** use `npx tsc` / `pnpm exec tsc` for the typecheck gate here (see the
tooling note above).

## Scope

**In scope** (test/setup only):
- `apps/web/components/projects/__tests__/asset-grid.test.tsx` (fixture value)
- `apps/web/lib/__tests__/api.test.ts` (mock shape)
- `apps/web/stores/__tests__/notification-store.test.ts` (mock verb + asserts)
- `apps/web/test/setup.ts` (deterministic localStorage)

**Out of scope** (do NOT touch — the product is correct, the tests are stale):
- `apps/web/lib/api.ts`, `apps/web/lib/auth.ts`,
  `apps/web/stores/notification-store.ts` — no runtime behavior changes.
- `apps/web/types/index.ts` — `AssetStatus` is correct; fix the fixture, not the type.
- `.github/workflows/ci.yml` — wiring CI to actually run `pnpm test` and dropping
  `continue-on-error` on the typecheck is the right follow-up, but it is a
  separate change (see Maintenance notes), not part of this plan.

## Git workflow

- Branch: `advisor/026-web-test-baseline`
- Conventional commits (e.g. `test(web): restore green vitest + tsc baseline`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix the asset-grid fixture status

In `apps/web/components/projects/__tests__/asset-grid.test.tsx:57`, change the
invalid status to a valid `AssetStatus`:

```diff
-  status: 'uploaded',
+  status: 'draft',
```

**Verify**: `cd apps/web && ./node_modules/.bin/tsc --noEmit` → exit 0, no errors.

### Step 2: Give the api.test fetch mocks a `.text()` method

In `apps/web/lib/__tests__/api.test.ts`, add a `text:` resolver to each
**success-path** mock so `await response.text()` returns the JSON string the test
expects. Three mocks need it:

- "successful GET request returns JSON data" (the `mockData` mock):
  ```ts
  text: () => Promise.resolve(JSON.stringify(mockData)),
  ```
- "adds Bearer token header when token exists" (the `{}` mock):
  ```ts
  text: () => Promise.resolve('{}'),
  ```
- "401 triggers token refresh and retries request" (the **second**,
  `{ success: true }` mock):
  ```ts
  text: () => Promise.resolve(JSON.stringify({ success: true })),
  ```

Leave the existing `json:` lines in place (harmless) and do not touch the
"throws ApiError" / "204 No Content" mocks.

**Verify**: `cd apps/web && pnpm test lib/__tests__/api.test.ts` → 5 passed.

### Step 3: Align notification-store.test with the store (`post`, `/me/...`)

In `apps/web/stores/__tests__/notification-store.test.ts`:

1. Mock `post` instead of `patch` (keep `get`):
   ```diff
   vi.mock('@/lib/api', () => ({
     api: {
       get: vi.fn(),
   -   patch: vi.fn(),
   +   post: vi.fn(),
     },
   }))
   ```
2. In both `markAllRead` and `markAsRead` tests, swap the mocked verb and fix the
   asserted path/args to match the store (single-arg `post`, `/me/...` paths):
   ```diff
   -    vi.mocked(api.patch).mockResolvedValue(undefined)
   +    vi.mocked(api.post).mockResolvedValue(undefined)
   ...
   -    expect(api.patch).toHaveBeenCalledWith('/notifications/read-all', {})
   +    expect(api.post).toHaveBeenCalledWith('/me/notifications/read-all')
   ...
   -    expect(api.patch).toHaveBeenCalledWith('/notifications/n1/read', {})
   +    expect(api.post).toHaveBeenCalledWith('/me/notifications/n1/read')
   ```

**Verify**: `cd apps/web && pnpm test notification-store` → 6 passed.

### Step 4: Make localStorage deterministic across Node versions

In `apps/web/test/setup.ts` (currently just
`import '@testing-library/jest-dom/vitest'`), install a small in-memory
`localStorage`/`sessionStorage` before tests run, so Node ≥ 22's built-in
Web Storage global cannot shadow jsdom's:

```ts
import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

function createStorage(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      store = {}
    },
  } as Storage
}

vi.stubGlobal('localStorage', createStorage())
vi.stubGlobal('sessionStorage', createStorage())

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
```

`vi.stubGlobal` overrides the global regardless of whether Node defined a
non-configurable built-in, so this is robust on Node 20 (CI) and Node 25
(local). If `vi.stubGlobal` proves insufficient for `window.localStorage` under
jsdom, fall back to
`Object.defineProperty(window, 'localStorage', { value: createStorage(), configurable: true })`
and report which you used.

**Verify**: `cd apps/web && pnpm test lib/__tests__/auth.test.ts` → 7 passed,
and no `--localstorage-file` warning in the output.

### Step 5: Full green gate

**Verify** (all must hold):
- `cd apps/web && ./node_modules/.bin/tsc --noEmit` → exit 0, no errors.
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → `Tests  123 passed (123)`, exit 0.

## Test plan

The change *is* the test suite, so the verification commands above are the test
plan. After the suite is green, confirm you changed **only** test/setup files
(`git status` shows just the four in-scope paths) and that no product `.ts`/`.tsx`
under `lib/`, `stores/`, `components/`, or `types/` was modified.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && ./node_modules/.bin/tsc --noEmit` exits 0, no errors
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0 with `123 passed (123)`
- [ ] Only the four in-scope test/setup files changed (`git status`); no product
      runtime files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live code (drift) — especially if
  `AssetStatus` now includes `'uploaded'`, or `notification-store.ts` uses
  `api.patch`/different paths than shown. In that case the *product* may have
  changed and the right fix may differ; report rather than guess.
- After Step 4, auth.test.ts still fails with a localStorage error — capture the
  exact error and the Node version (`node --version`) and report.
- Making any test pass appears to require editing a product runtime file
  (`api.ts`, `auth.ts`, `notification-store.ts`, `types/index.ts`). That would
  mean a real product bug, not stale tests — STOP and report the mismatch.

## Maintenance notes

- **Root cause is missing CI coverage.** `.github/workflows/ci.yml` never runs
  `pnpm test` for `apps/web`, and its typecheck step is `continue-on-error: true`
  (ci.yml:154-156). Strongly recommended follow-up (separate plan): add a
  `pnpm --filter web test` step and drop `continue-on-error` on the typecheck so
  this baseline cannot rot again. Out of scope here to keep the change
  test-only and low-risk.
- **Node version.** The project targets Node 20 (CI + Docker). There is no
  `.nvmrc`/`engines` pin, so local dev drifts to newer majors (Node 25 here),
  which is what exposed the localStorage collision. Adding `apps/web/.nvmrc`
  (`20`) and an `engines` field is a reasonable DX follow-up; the Step 4 fix
  makes the suite pass regardless, so it is not required for green.
- **`tsc` shim.** The global `tsc` joke package on a dev machine hijacks
  `npx tsc`/`pnpm exec tsc`. Consider `npm rm -g tsc` locally; the repo itself is
  unaffected. Earlier plan command tables (021–025) say `npx tsc --noEmit` — they
  should be updated to `./node_modules/.bin/tsc --noEmit`.
