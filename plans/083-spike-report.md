# Plan 083: Next.js 15 migration spike report

Date: 2026-07-13  
Branch/worktree: `advisor/083-next15-spike` / `/private/tmp/ff-083`  
Overall status: **GREEN**. TypeScript, all 230 tests, and the production build
pass on Next 15.5.20 + React 19.2.7. (Inside the sandbox the plain build was
blocked only by Google Fonts DNS; the reviewer re-ran it with network — exit 0.)

Dispatcher amendments were honored: no dependency install/codemod rerun, no
Docker, no `plans/README.md` edit, no commit, and no push.

## Baseline

Dispatcher-recorded pre-bump baseline from the same tree:

| Gate | Baseline result |
| --- | --- |
| Vitest | 230/230 passed |
| `pnpm exec tsc --noEmit` | exit 0, zero errors |
| `pnpm build` | exit 0 |

Baseline timings were not supplied by the dispatcher and were not recreated
because the tree was already upgraded when this executor started.

## Versions chosen

| Package | Before | Upgraded spec | Installed |
| --- | --- | --- | --- |
| `next` | `14.2.35` | `15.5.20` | `15.5.20` |
| `eslint-config-next` | `14.2.29` | `15.5.20` | `15.5.20` |
| `react` | `^18.3.1` | `^19.2.7` | `19.2.7` |
| `react-dom` | `^18.3.1` | `^19.2.7` | `19.2.7` |
| `@types/react` | `^18.3.18` | `^19.2.17` | `19.2.17` |
| `@types/react-dom` | `^18.3.5` | `^19.2.3` | `19.2.3` |
| `typescript` | `^5.8.3` | unchanged | `5.9.3` in lockfile |

Installed `next@15.5.20` declares React peers compatible with either React
18.2+ or React 19. This spike keeps the dispatcher's React 19 choice because
the migrated client pages resolve Promise-based route props with React `use()`.
Consequences found here: nullable ref contracts and suspended-Promise test
rendering required small type/test updates.

No pinned-library STOP condition was hit. Installed peer metadata supports
React 19 for Zustand, SWR, cmdk, Radix Dialog, lucide-react, and
react-zoom-pan-pinch; hls.js and Fabric declare no React peer.

## Codemod result and diffstat

Codemod: `@next/codemod@15.5.20 next-async-request-api`.

- 3 files modified
- 166 files unmodified
- 1 codemod error
- Error file identified manually: `apps/web/app/share/[token]/page.tsx`

Codemod-only route diffstat captured before manual fixes:

```text
apps/web/app/(auth)/invite/[token]/page.tsx                 |  8 +++++---
apps/web/app/(auth)/reset-password/[token]/page.tsx         |  8 +++++---
apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx | 13 +++++++------
3 files changed, 17 insertions(+), 12 deletions(-)
```

Dispatcher bump + codemod working-tree diffstat at executor start:

```text
5 files changed, 766 insertions(+), 671 deletions(-)
```

Those five files were the three route pages above, `apps/web/package.json`,
and `apps/web/pnpm-lock.yaml`.

## Five-section triage taxonomy

### 1. Async `params` / `searchParams`

Affected route files:

- `apps/web/app/(auth)/invite/[token]/page.tsx` — codemod changed `params` to
  `Promise<{ token: string }>` and resolves it with React `use()`.
- `apps/web/app/(auth)/reset-password/[token]/page.tsx` — same change.
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` — codemod
  changed project/asset params to a Promise and resolves them with React
  `use()`.
- `apps/web/app/share/[token]/page.tsx` — codemod error identified here and
  fixed manually with `Promise<{ token: string }>` plus `React.use(params)`.

Related test fix:

- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/__tests__/folder-direct-access.test.tsx`
  now supplies Promise params and awaits React's `act` boundary. Initial
  `Promise.resolve(...)` props typechecked but six tests rendered an empty
  suspended boundary; awaiting `act` restored the same assertions and fixture
  semantics.

Dynamic client pages using `useParams()` were inspected and require no async
page-prop change: project root, asset detail, collections, project settings,
and dashboard asset pages.

No `searchParams` page-prop migration was required. Existing
`useSearchParams()` client-hook usage remains valid.

### 2. Caching-default changes

- `apps/web/middleware.ts` still calls `/setup/status` with
  `cache: 'no-store'`; the explicit security-sensitive behavior survived.
- The only other `fetch()` calls under `app/` are in client components:
  `app/share/[token]/page.tsx` and
  `app/(dashboard)/projects/[id]/settings/page.tsx`. Next 15's server `fetch`
  default change does not alter those browser requests.
- No App Router `route.ts` GET handlers exist, so the changed GET-handler
  caching default has no current target.
- No explicit `cache:` or `revalidate` annotations were added.
- SWR/Zustand remain the client data/state layer. Live browser navigation
  performance could not be observed because the sandbox cannot bind a dev
  server; the full migration should still smoke-test back/forward and repeated
  project navigation for the changed client router-cache defaults.

### 3. Middleware behavior

No middleware source change was needed.

`pnpm dev` could not bind in the sandbox:

```text
Error: listen EPERM: operation not permitted 0.0.0.0:3000
```

The actual TypeScript middleware was then compiled in-memory with Next's SWC
and invoked with real `NextRequest` objects:

| Scenario | Observed result |
| --- | --- |
| `/projects`, setup cookie present, no auth cookies | `307` to `/login?from=%2Fprojects` |
| `/share/x`, no cookies | `200`, `x-middleware-next: 1` |
| `/invite/x`, no cookies | `200`, `x-middleware-next: 1` |
| `/projects`, access-token cookie present | `200`, `x-middleware-next: 1` |

The plan text expected a `302`; the current implementation's
`NextResponse.redirect(...)` default produced `307`. This spike did not change
that pre-existing redirect choice. If an exact `302` is a product/security
requirement, the follow-up plan must call it out explicitly.

The successful diagnostic production build emitted middleware and preserved
the matcher exclusions for `_next/static`, `_next/image`, `favicon.ico`, API
routes, images, and font assets.

### 4. Third-party and React 19 breakage

React 19 exposed nullable ref types created by `useRef<T>(null)`. Local return
and prop contracts were corrected, without runtime behavior changes:

- `apps/web/hooks/use-drawing.ts`
- `apps/web/hooks/use-video-player.ts`
- `apps/web/components/review/image-viewer.tsx`
- `apps/web/components/review/video-player.tsx`

The existing share-video-player test mock then typechecks naturally with
`videoRef.current: null`.

Third-party results:

- hls.js, Fabric, Zustand, SWR, react-zoom-pan-pinch, cmdk, Radix, and lucide
  compile under React 19.
- 230/230 existing tests pass.
- `next/font/google` for Space Grotesk/Mono and `next/font/local` for Doto all
  compile in the diagnostic build. Built CSS contains
  `--font-space-grotesk`, `--font-space-mono`, and `--font-doto`, so the
  font-variable-on-`<html>` setup survives.
- Next 15 generated `target: "ES2017"` in `apps/web/tsconfig.json` and updated
  `apps/web/next-env.d.ts` with generated route types. Both are retained as
  framework migration output.

### 5. Unresolvable inside this sandbox

1. Plain `pnpm build` cannot fetch Space Grotesk/Mono because network/DNS is
   disabled:

   ```text
   getaddrinfo ENOTFOUND fonts.googleapis.com
   `next/font` error: Failed to fetch `Space Grotesk` from Google Fonts.
   `next/font` error: Failed to fetch `Space Mono` from Google Fonts.
   ```

   This is the only plain-build blocker. With
   `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` pointing at temporary local responses,
   a cold-cache build compiled, typechecked, generated 19/19 static pages,
   emitted middleware, collected traces, and exited 0. The temporary response file is
   not part of the deliverable.

2. Live middleware HTTP curls are unavailable because `pnpm dev` cannot bind
   port 3000 (`EPERM`). In-process middleware execution is recorded above.

3. `pnpm list --depth 0` hit pnpm's local store-index SQLite permission error
   (`unable to open database file`). Installed package manifests and the green
   gates were used for compatibility checks instead. No install was attempted.

No application-code migration error remains unresolved.

## Gate results

| Gate | Status | Evidence |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | **GREEN** | initial 9 errors; final exit 0 |
| `pnpm exec vitest run` | **GREEN** | 45 files, 230/230 tests, 3.94s |
| plain `pnpm build` | **GREEN** | sandbox run hit Google Fonts DNS `ENOTFOUND`; reviewer re-ran with network post-spike — exit 0, all pages generated |
| cold-cache diagnostic build with Next font mocks | **GREEN** | compile + types + 19/19 pages + traces, exit 0 |
| live `pnpm dev` middleware curl | **NOT GREEN (environment)** | bind `EPERM` |
| in-process middleware verification | **GREEN with note** | correct auth/public behavior; redirect is 307, not plan's 302 wording |

## Deployment status

**not reached — no Docker in sandbox**

Non-Docker inspection still found:

- `next.config.js` retains `output: 'standalone'`.
- Diagnostic build produced `.next/standalone/server.js`.
- `Dockerfile.allinone` still copies `.next/standalone`, `.next/static`, and
  `public` to the expected runtime locations.
- `apps/web/Dockerfile` remains a development image (`pnpm dev`), not the
  standalone production image.

No Docker image build or `/login` container smoke test was attempted.

## Migration plan

Estimated effort: **2–3 engineer-days**, including live browser and Docker QA.

1. **Create the real migration branch and pin the spike versions** — 0.25 day.
   Update `package.json` and lockfile to the exact versions above.
   Verification: frozen-lockfile install in a networked Node 20/pnpm 10
   environment; inspect peer warnings; STOP on any incompatible pinned peer.

2. **Apply async request API migration** — 0.25 day. Re-run the pinned
   `next-async-request-api` codemod, retain the three successful changes, and
   manually migrate `app/share/[token]/page.tsx`.
   Verification: route scan shows no synchronous dynamic page props; `tsc`
   exits 0.

3. **Adopt React 19 type/test fallout** — 0.25 day. Carry the four nullable ref
   contracts and the awaited Promise-prop route test change.
   Verification: focused folder-direct test passes, then all 230+ tests pass
   without React `act`/suspense warnings.

4. **Retain Next-generated TypeScript declarations/config** — 0.1 day. Keep
   `target: "ES2017"` and the generated route-types reference.
   Verification: a clean build does not rewrite tracked config files.

5. **Audit caching behavior in a real browser** — 0.5 day. Confirm the
   middleware setup fetch stays `no-store`; verify repeated project/share
   navigation, back/forward behavior, and SWR revalidation under Next 15's
   router-cache defaults.
   Verification: browser console clean; network panel shows expected API call
   count; no stale project/share data.

6. **Verify middleware and public share routes over HTTP** — 0.25 day. Run a
   real dev/production server and test anonymous/authenticated dashboard,
   `/share/*`, `/invite/*`, static assets, and setup redirect behavior.
   Verification: explicit status/location matrix. Decide whether 307 is
   accepted or an exact 302 must be implemented and tested.

7. **Build in networked CI and verify fonts** — 0.25 day. Run plain
   `pnpm build` with Google Fonts access, then inspect generated font variables
   and a rendered page. If release builds must work without egress, replace
   Google font imports with checked-in local font files as a separately reviewed
   visual/deployment decision.
   Verification: plain build exit 0; Space Grotesk/Mono and Doto render with no
   layout shift or missing-variable regression.

8. **Verify both deployment surfaces** — 0.5–1 day. Build the all-in-one image
   and any supported web image, smoke `/login`, anonymous `/projects`, and
   `/share/x` behind nginx.
   Verification: image build exit 0, health checks pass, middleware redirect
   matrix matches Step 6, and standalone files resolve at runtime.

9. **Close security/tooling gates** — 0.25 day. Run `tsc`, Vitest, build,
   lint, and `pnpm audit --prod` in CI's Node 20/pnpm 10 environment.
   Verification: zero type errors, all tests pass, build exit 0, no new lint
   errors, and the named Next 14 high advisories are absent.

### React 19 decision

Keep React 19 for the real migration. It matches the dispatcher's installed
spike, supports React `use()` in client route pages, and all inspected pinned
libraries are compatible. Required consequences are already inventoried:
nullable DOM refs and awaited suspended-Promise route tests. Reverting to React
18 would require a different page-component architecture and another spike; it
offers no benefit found here.

### STOP-worthy risks for the real migration

- Any frozen install reports a React 19-incompatible pinned dependency.
- Auth/public-share middleware behavior differs between Next 14 and Next 15,
  including redirect status/location, cookie handling, matcher exclusions, or
  `/share/*` access.
- A caching fix would require API changes or test-fixture semantic changes.
- Plain build remains unable to fetch fonts in the actual CI/Docker build
  environment and no explicit egress-vs-local-font decision has been made.
- Font output or `<html>` variables change visual layout.
- Standalone output no longer matches `Dockerfile.allinone` copy/runtime paths.
- Codemod scope unexpectedly exceeds the observed four route files.
