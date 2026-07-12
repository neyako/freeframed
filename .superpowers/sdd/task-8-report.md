# Task 8 report: honor folder-scoped direct access

## Status

PASS after live revocation remediation. Authenticated direct-folder recipients can browse only active granted roots and descendants, with per-root `view`, `comment`, and `approve` capability. They do not become project members and cannot access project-root, sibling, member, trash, mutation, sharing, settings, or raw-download surfaces. Soft-deleting grants revokes API and browser access immediately without deleting project data.

The required commit is created only after this report, evidence validation, cleanup, scope audit, and independent review all pass.

## Clean start and dependency gate

- Worktree: `/private/tmp/freeframed-078-audit-remediation`
- Branch: `advisor/078-audit-verdict-remediation`
- Authorized implementation HEAD: `7ff73ff861c6e01061ffab7386d992df1392a34b`
- Todo 11 dependency commits present:
  - `998a8ec fix(folders): reject cyclic bulk moves`
  - `7ff73ff fix(folders): revalidate locked hierarchy state`
- Todo 11 hierarchy coverage was green before Todo 8 implementation.
- Worktree was clean before Todo 8 tests-only RED.
- No concurrent writer owned a declared Todo 8 file.

## Environment

- Local Node: `v25.2.1`; local pnpm: `11.9.0`.
- Repository target remains Node 20 and pnpm 10; no package or lockfile changed.
- Local PostgreSQL 17 provided real-database verification.
- Docker CLI was present, but the Docker daemon socket remained unavailable. Compose/AIO verification is deferred under the brief's explicit environment exception.

## Unchanged baseline

The executor ran the brief's PostgreSQL permission/hierarchy/project/share/comment baseline and the existing project-page/AssetGrid web baseline before tests-only RED. No unexplained baseline failure occurred. Python dependency and listener restrictions were avoided through the approved local PostgreSQL and temporary cache paths.

## Tests-only RED

Before product edits, the diff contained only declared test/support paths. Valid behavior RED included:

- private folder recipient could not load the project envelope;
- project/tree/asset collection scope was absent or over-broad;
- active-project soft-delete filtering was missing;
- duplicate grants produced duplicate browse roots;
- folder-direct project response exposed full project metadata and invoked poster signing;
- scoped `AssetGrid` retained drag and share-selection behavior;
- selected project asset exposed raw Download;
- view permission exposed reply and comment mutations;
- approval response handling did not match the real bare-list API shape;
- deep links could deny before the scoped tree finished loading.

Recorded review RED receipts:

- Frontend AssetGrid: 2 expected failures for a draggable source and scoped/share-mode selection.
- Frontend project controls: 2 expected failures for view mutations and folder-direct Download.
- Real PostgreSQL: active-project filter, duplicate-root, minimal-response/poster-presign, and resolver behavior failures. Final resolver RED was 3 failed and 6 passed.

No RED was caused by import, fixture, migration, missing dependency, or local-port setup.

## Minimal implementation

Backend:

- added frozen typed folder-access resolution with deterministic minimal roots while retaining every active grant;
- filtered active `Project`, `Folder`, `Asset`, `AssetShare`, membership, version, and link state;
- preserved member/public precedence and kept private folder shares out of `GET /projects`;
- returned the exact seven-key folder-direct project contract: `asset_count`, `folder_access`, `id`, `member_count`, `name`, `role`, and `storage_bytes`;
- scoped folder tree/list and asset list in SQL before materialization;
- normalized accessible roots to `parent_id=null`;
- enforced project membership for raw download while preserving scoped playback;
- validated exact active secure folder tokens before grant mutation or email dispatch;
- preserved comments and approvals through existing Todo 1/7 capability checks.

Frontend:

- added typed folder-direct access helpers and effective per-folder permission resolution;
- stopped eager member/trash/user/root/sibling collection requests;
- added narrow scoped-read-only behavior to `AssetGrid`, `AssetCard`, and `FolderTree`;
- hid project-root, trash, member, upload, share, settings, move, rename, delete, bulk, new-version, and raw-download controls;
- mapped view/comment/approve to immutable comments, comment mutations, and approval actions;
- refreshed approval state from the real bare-list response;
- blocked collection fetch until deep-link scope was known;
- added a fail-closed project-fetch error gate after live revocation exposed an unscoped fallback shell.

Controller-authorized narrow scope additions were limited to `AssetCard`, `ApprovalBar`, and the collections callers/tests needed to make read-only cards, approval refresh/error handling, and collections denial truthful. They are part of Todo 8's authorized staged scope and do not expand into a restyle or unrelated review flow.

## Focused GREEN twice

The final Todo 8 focused gate passed 60 tests after the independent review loop added two stale-state/capability-truth regressions. Earlier frontend and real-PostgreSQL subsets were also repeated while implementing the scoped behavior.

The query-bound test executed scoped project/tree/assets with the baseline descendant set, added 25 descendants, and asserted the SQL statement count remained exactly equal.

## Full automated verification

Accepted API inventory is partitioned because the Quick Share migration test intentionally downgrades its shared schema and the durable-schema contract requires the fixed Todo 3 database. One monolithic pytest process is not a valid inventory gate.

| Partition | Result |
| --- | ---: |
| API unit | 169 passed |
| API non-destructive integration | 306 passed |
| Quick Share migration contract | 7 passed |
| Durable schema contract | 23 passed |
| Total | 505 passed across 52 unique files |

Final accepted web inventory:

- `pnpm test`: 45 files, 238 tests passed;
- `pnpm exec tsc --noEmit`: exit 0;
- `pnpm lint`: exit 0 with seven inherited React-hook warnings;
- `pnpm build`: exit 0;
- production build with the local API base baked into the bundle: exit 0.

Final revocation regression:

```text
rtk pnpm test -- 'app/(dashboard)/projects/[id]/__tests__/page-folder-direct-access.test.tsx'
```

RED: 44 files executed, 228 passed and 1 failed. A project SWR 403 rendered Project/Deleted and the unscoped asset shell instead of Access denied.

GREEN after the minimal error gate was superseded by the final 45-file, 238-test full-web inventory.

Final post-fix gates:

- TypeScript: exit 0, zero errors.
- Lint: exit 0, zero errors, seven inherited warnings.
- Production build with the local API base: exit 0; 19 static pages generated.
- `git diff --check`: exit 0.
- changed Python compilation: exit 0.

## Live HTTP and SQL matrix

Synthetic stable labels represented two accessible roots with three grants: root A/view, nested A1/approve, and root B/comment. A separate view-only recipient and one private out-of-scope sibling were included.

Project and collection behavior:

- exact project response keys: `asset_count`, `folder_access`, `id`, `member_count`, `name`, `role`, `storage_bytes`;
- exact scoped values: `asset_count=3`, `storage_bytes=3072`, `member_count=0`, `role=null`;
- private project absent from the general project list;
- tree/list roots normalized and deterministic;
- scoped asset list contained only the three granted-subtree assets;
- project-root asset list returned an empty list;
- view-only root access returned 200;
- view-only sibling filter returned 404 and sibling asset returned 403;
- exact descendant asset, versions, comments, and playback stream returned 200;
- raw original download returned 403;
- members and trash returned 403.

Every valid-body mutation attempt returned 403: project settings, folder create/rename/delete, asset rename/delete/move, bulk move, new version, share link, and direct share.

Capability behavior:

- comment root create: 201;
- comment root reply: 201;
- view comment: 403;
- view approve: 403;
- comment approve: 403;
- browser Approve: 200, then `You approved`, with buttons removed;
- browser Reject: 200, then `You rejected`, with buttons removed.

Revocation repeated project, tree, folders, assets, exact asset, versions, stream, comments, comment mutation, approval, members, and trash. All twelve returned 403.

PostgreSQL before and after revocation remained identical except active grant state:

| Row group | Before | After |
| --- | ---: | ---: |
| Project | 1 | 1 |
| Folders | 4 | 4 |
| Assets | 3 | 3 |
| Versions | 3 | 3 |
| Media | 3 | 3 |
| Comments | 0 | 0 |
| Approvals | 1 | 1 |
| Active grants | 3 | 0 |
| Total grant rows | 4 | 4 |

## Browser and visual QA

Desktop and mobile checks covered project browsing and pending, approved, rejected, and revoked states.

- scoped grid contained zero `[draggable]` nodes;
- no member, trash, user-batch, root-asset, or sibling collection request occurred in active scoped browsing;
- view asset had no comment input or approval controls;
- comment asset had a working comment input and no approval controls;
- approve asset had a working comment input plus Approve/Reject;
- all view/comment/approve checks passed at desktop and mobile widths with zero page errors;
- project and asset surfaces contained zero draggable nodes and no raw Download, New version, Share asset, Upload, Share, or New folder controls;
- active project browsing made no member, trash, user-batch, root-asset, or forbidden-folder collection request;
- valid deep A2 URL loaded only A2 folder/asset collections;
- explicit out-of-scope URL rendered Access denied and made no folder/asset collection request;
- collections rendered Access denied without fetching the collections API;
- an approvals-list 403 rendered `Unable to load approvals` and hid Approve/Reject;
- project-member reviewer precedence retained Approve/Reject;
- live Reject and Approve each returned 200, refreshed to `You rejected` / `You approved`, and removed both action buttons;
- post-revocation desktop/mobile project and asset reloads rendered only Access denied and global app navigation, with no privileged controls, project collections, draggable nodes, or page errors.

Fresh post-source visual captures cover active desktop/mobile view, comment, approve, project, deep-link, collections/error, member reviewer, approved/rejected, and revoked project/asset states. Independent visual verdicts are recorded in the final review section below. A real one-second synthetic MP4 was supplied only to the browser visual fixture so active review captures render cleanly; the authenticated HLS authorization endpoint remained separately verified at 200.

## Independent review remediation

Fresh code review found one real stale-SWR defect: retained project/asset data could keep navigation collection keys active while revalidation returned 403. TDD reproduced four expected REDs across stale project keys, stale asset navigation keys, scoped empty-state copy, and approval-error contrast. Minimal GREEN changes now:

- require an error-free project envelope before project assets/folders/trash are eligible;
- require error-free project and review state before asset folder-tree/all-assets navigation is eligible;
- use neutral `No assets in this folder` copy for scoped read-only empty state;
- render approval-load failure with the existing semantic accent color.

The post-fix focused run executed the complete 45-file web inventory: 238 passed. Fresh TypeScript, lint, production build, active/revoked browser, code, goal, security, context, QA, and dual visual verdicts are recorded below.

| Final independent lane | Verdict | Confidence/severity |
| --- | --- | --- |
| Goal and constraints | PASS | High |
| Code quality/correctness | PASS | 0.98 |
| Security | PASS | None |
| Context and caller coverage | PASS | 0.97 |
| Hands-on QA | PASS | High |
| Visual integrity | PASS | High |
| Visual fidelity/responsive/text | PASS | High |

All final verdicts were issued against the post-fix source, 45-file/238-test receipt, and fresh current-source captures. No stale pre-fix verdict was accepted.

## Evidence and redaction

Machine-readable evidence: `.omo/evidence/078/task-8/folder-direct-share.json`.

The evidence contains only stable scenario labels, permission names, response keys, status codes, booleans, and row/test counts. It contains no raw access token, share token, session, cookie, password, email address, comment body, authorization header, token-bearing URL, presigned URL, S3 key, or private file content.

## Pure LOC

Every new Python file remains below 250 pure LOC:

- `apps/api/services/folder_access.py`: 202
- `apps/api/tests/integration/_folder_scope_support.py`: 158
- `apps/api/tests/integration/test_folder_direct_edge_matrix_db.py`: 73
- `apps/api/tests/integration/test_folder_direct_email_db.py`: 118
- `apps/api/tests/integration/test_folder_direct_mutation_matrix_db.py`: 58
- `apps/api/tests/integration/test_folder_direct_resolver_db.py`: 141
- `apps/api/tests/integration/test_folder_direct_scope_db.py`: 198

## Changed files

Backend product:

- `apps/api/services/folder_access.py`
- `apps/api/schemas/project.py`
- `apps/api/routers/projects.py`
- `apps/api/routers/folders.py`
- `apps/api/routers/assets.py`
- `apps/api/routers/share.py`

Frontend product:

- `apps/web/types/index.ts`
- `apps/web/lib/project-access.ts`
- `apps/web/hooks/use-folders.ts`
- `apps/web/app/(dashboard)/projects/[id]/page.tsx`
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`
- `apps/web/app/(dashboard)/projects/[id]/collections/page.tsx`
- `apps/web/components/projects/asset-grid.tsx`
- `apps/web/components/projects/asset-card.tsx`
- `apps/web/components/projects/folder-tree.tsx`
- `apps/web/components/review/approval-bar.tsx`

Tests/support:

- `apps/api/tests/test_assets_stream_url.py`
- `apps/api/tests/integration/_folder_scope_support.py`
- `apps/api/tests/integration/test_folder_direct_scope_db.py`
- `apps/api/tests/integration/test_folder_direct_email_db.py`
- `apps/api/tests/integration/test_folder_direct_edge_matrix_db.py`
- `apps/api/tests/integration/test_folder_direct_mutation_matrix_db.py`
- `apps/api/tests/integration/test_folder_direct_resolver_db.py`
- `apps/web/lib/__tests__/project-access.test.ts`
- `apps/web/app/(dashboard)/projects/[id]/__tests__/page-folder-direct-access.test.tsx`
- `apps/web/app/(dashboard)/projects/[id]/__tests__/page-folder-direct-controls.test.tsx`
- `apps/web/app/(dashboard)/projects/[id]/__tests__/page-upload-drop.test.tsx`
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/__tests__/folder-direct-access.test.tsx`
- `apps/web/app/(dashboard)/projects/[id]/collections/__tests__/folder-direct-access.test.tsx`
- `apps/web/components/projects/__tests__/asset-grid.test.tsx`
- `apps/web/components/projects/__tests__/folder-tree.test.tsx`
- `apps/web/components/review/__tests__/approval-bar.test.tsx`

Artifacts:

- `.omo/evidence/078/task-8/folder-direct-share.json`
- `.superpowers/sdd/task-8-report.md`

## Finalization commands

Sensitive local URLs and session material are redacted while preserving the exact command structure:

```text
PYTHONPYCACHEPREFIX=/private/tmp/ff078-task8-pycache rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python /private/tmp/ff078-task8-live-latest.py
MODE={project,assets-desktop,assets-mobile,links,collections-reviewer} NODE_PATH=<cached-playwright-node-modules> node /private/tmp/ff078-task8-browser-active-final.cjs
ACTION={reject,approve} NODE_PATH=<cached-playwright-node-modules> node /private/tmp/ff078-task8-browser-approval-action.cjs
PYTHONPYCACHEPREFIX=/private/tmp/ff078-task8-pycache rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python /private/tmp/ff078-task8-revoke-final.py
MODE={desktop,mobile} NODE_PATH=<cached-playwright-node-modules> node /private/tmp/ff078-task8-browser-revoked-final.cjs
PYTHONPYCACHEPREFIX=/private/tmp/ff078-task8-final-pycache rtk python3 -m py_compile <all changed Python product/test files>
(cd apps/web && rtk pnpm test)
(cd apps/web && rtk pnpm exec tsc --noEmit)
(cd apps/web && rtk pnpm lint)
(cd apps/web && NEXT_PUBLIC_API_URL=<redacted-local-api-url> rtk pnpm build)
rtk git diff --check
```

## Cleanup receipt

Cleanup completed after all independent reviewers finished reading the fresh captures. Final receipt proved:

- Playwright session closed and `.playwright-cli` removed;
- FastAPI and Next stopped;
- PostgreSQL clusters on 55438 and 55433 stopped;
- ports 18008, 13008, 55438, and 55433 closed;
- `.next`, screenshots, cookies, seed/launcher scripts, PostgreSQL data/logs, pycache, pytest cache, and debug journal removed;
- only product/tests plus this redacted evidence/report remain.

## Self-review

- Access precedence remains member, public, folder-direct, deny.
- Mixed grants resolve per selected folder; no project-wide maximum is used.
- Active/deleted state is filtered at every authorization and collection boundary.
- Scoped SQL filters run before response materialization.
- Folder roots are normalized without leaking their real parent.
- Direct grant never creates membership or adds a private project to project listing.
- Failed token validation precedes grant/email side effects.
- Revoked or failed project fetch now fails closed in the browser.
- No model, migration, permission-kernel, comment router/schema, guest review, package, lockfile, runtime, Docker, pagination, branding, watermark, or theme file changed.

## Concerns

- Docker Compose/AIO remains deferred because the Docker daemon is stopped.
- The live synthetic media fixture proves authorization and HLS proxy routing but not object delivery because no MinIO object exists.
- API inventory must remain partitioned; migration tests intentionally require isolated schema states.
