# Plan 005: Project-tree vs final-video provisioning option

> **Executor instructions**: This plan modifies the **projmgmt** repository, NOT
> the repo these plan files live in. Work in `/Users/neyako/projmgmt`. Follow the
> steps in order, run every verification, and honor STOP conditions. When done,
> update the status row for this plan in
> `/Users/neyako/freeframed/plans/README.md`.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/projmgmt diff --stat 1905a0b..HEAD -- src/lib/nextcloud.ts src/actions/projects.ts`
> Compare the "Current state" excerpts against the live code on any change; on a
> mismatch, treat it as a STOP condition.

## Status

- **Target repo**: projmgmt — `/Users/neyako/projmgmt`
- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: feature
- **Planned at**: projmgmt commit `1905a0b`, 2026-06-28

## Why this matters

Per the decided architecture, the whole project tree (assets, sfx, luts, vfx, footage, exports)
lives in Nextcloud/NAS — only the final video goes to FreeFrame for review. Today projmgmt's
`provisionNextcloudFolder` creates **only the top-level project folder**, so the editor has to
hand-build the same subfolder structure for every project. This plan gives the user a choice when
provisioning a project's storage: scaffold the **full production tree** (subfolders for each asset
class) or keep it **final-only** (just the project folder, for teams that only drop in the export).
It's a small, self-contained Nextcloud/UX improvement that makes the "where do assets live"
half of the workflow consistent and one-click.

## Current state

### `src/lib/nextcloud.ts` — `provisionNextcloudFolder` (lines 172–198)

```ts
export async function provisionNextcloudFolder(projectName: string): Promise<string | null> {
  const config = getNextcloudConfig();
  const cleanProjectName = projectName.trim();

  if (!config || !cleanProjectName) {
    if (!cleanProjectName) {
      console.warn("[Nextcloud] Cannot provision folder without a project name.");
    }
    return null;
  }

  const projectPath = buildProjectPath(config.basePath, cleanProjectName);
  const client = getWebDavClient(config);

  try {
    const exists = await client.exists(projectPath);

    if (!exists) {
      await client.createDirectory(projectPath);
    }

    return projectPath;
  } catch (error) {
    console.error(`[Nextcloud] Failed to provision folder "${projectPath}": ${getErrorMessage(error)}`);
    return null;
  }
}
```

Helpers already in this file: `getNextcloudConfig()`, `buildProjectPath(basePath, name)` (line 73),
`getWebDavClient(config)`, `getErrorMessage(error)`. The `webdav` client exposes
`client.exists(path)` and `client.createDirectory(path)`.

### `src/actions/projects.ts` — current caller

`provisionNextcloudFolder` is imported (line 10) and called inside `updatePlatformIds` when a
folder name is set (line 1224):

```ts
    if (nextFolderName) {
      await provisionNextcloudFolder(nextFolderName);
    }
```

`getNextcloudFolderName(project)` (line 149) returns `project.folderName?.trim() || project.title`.
Server actions are `"use server"` and return `ActionResult` (`{ success, ... } | { success:false, error }`).

### `.env.example`

Has the `NEXTCLOUD_*` block (`NEXTCLOUD_BASE_PATH="/Studio_Projects"`, etc.). No subfolder config.

### UI

`src/components/modals/ProjectDetailsModal.tsx` is the project detail surface and the place that
saves `folderName` (via `updatePlatformIds`). It is a large file; the UI step below is deliberately
narrow and has a STOP escape if the anchor isn't found cleanly.

**Conventions:** integration code in `src/lib/*.ts` reads env through a guarded `getXConfig()`;
server actions live in `src/actions/*.ts`. Match `provisionNextcloudFolder`'s existing error
handling (return `null` / `console.error("[Nextcloud] ...")`).

## Commands you will need

| Purpose | Command (from `/Users/neyako/projmgmt`) | Expected |
|---------|------------------------------------------|----------|
| Install | `npm install` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Build | `npm run build` | exit 0 |

No unit-test runner exists; verify by typecheck + build + the manual check in the Test plan.

## Scope

**In scope** (in `/Users/neyako/projmgmt`):
- `src/lib/nextcloud.ts` — add subfolder scaffolding to `provisionNextcloudFolder` via a new
  `structure` param + a `getProjectSubfolders()` helper.
- `src/actions/projects.ts` — add a `provisionProjectStructure(projectId, structure)` server action.
- `.env.example` — add `NEXTCLOUD_PROJECT_SUBFOLDERS`.
- `src/components/modals/ProjectDetailsModal.tsx` — add a "Full tree / Final only" choice that
  calls the new action (bounded; STOP escape if the anchor is unclear).

**Out of scope**:
- The FreeFrame repo — unrelated to this plan.
- `updatePlatformIds`'s existing behaviour — leave its `provisionNextcloudFolder(nextFolderName)`
  call as-is (it keeps the default "final" behaviour). Do not change its signature.
- Prisma schema — no DB change. Storage structure is a Nextcloud concern, not persisted.
- Actual file upload — editors upload via their Nextcloud/NAS client; this plan scaffolds folders
  only. Do not build a file uploader.

## Git workflow

- Branch (in projmgmt): `feat/project-tree-provisioning`
- Commit, e.g. `feat: scaffold full project subfolder tree in Nextcloud`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a configurable subfolder list + scaffold logic

In `src/lib/nextcloud.ts`, add a helper and extend `provisionNextcloudFolder` with an optional
`structure` parameter. Keep the default `"final"` so existing callers are unchanged.

```ts
const DEFAULT_PROJECT_SUBFOLDERS = [
  "Footage",
  "Assets",
  "SFX",
  "Music",
  "LUTs",
  "VFX",
  "Graphics",
  "Exports",
  "Drafts",
];

function getProjectSubfolders(): string[] {
  const raw = process.env.NEXTCLOUD_PROJECT_SUBFOLDERS;
  if (!raw) return DEFAULT_PROJECT_SUBFOLDERS;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_PROJECT_SUBFOLDERS;
}
```

Change the signature and body of `provisionNextcloudFolder`:

```ts
export async function provisionNextcloudFolder(
  projectName: string,
  structure: "tree" | "final" = "final"
): Promise<string | null> {
  const config = getNextcloudConfig();
  const cleanProjectName = projectName.trim();

  if (!config || !cleanProjectName) {
    if (!cleanProjectName) {
      console.warn("[Nextcloud] Cannot provision folder without a project name.");
    }
    return null;
  }

  const projectPath = buildProjectPath(config.basePath, cleanProjectName);
  const client = getWebDavClient(config);

  try {
    const exists = await client.exists(projectPath);
    if (!exists) {
      await client.createDirectory(projectPath);
    }

    if (structure === "tree") {
      for (const sub of getProjectSubfolders()) {
        const subPath = buildProjectPath(projectPath, sub);
        // eslint-disable-next-line no-await-in-loop -- sequential mkdir avoids WebDAV race
        if (!(await client.exists(subPath))) {
          // eslint-disable-next-line no-await-in-loop
          await client.createDirectory(subPath);
        }
      }
    }

    return projectPath;
  } catch (error) {
    console.error(`[Nextcloud] Failed to provision folder "${projectPath}": ${getErrorMessage(error)}`);
    return null;
  }
}
```

Confirm `buildProjectPath` works for a nested path (it joins `base` + `/name` and normalises
slashes — passing the already-built `projectPath` as the base produces `projectPath/sub`). If
`buildProjectPath` strips or rejects nested input, build the subpath as
`` `${projectPath}/${sub}` `` and normalise duplicate slashes instead. Verify against
`buildProjectPath` at line 73.

**Verify**: `grep -n "structure: \"tree\" | \"final\"" src/lib/nextcloud.ts` → one match.

### Step 2: Add the `provisionProjectStructure` server action

In `src/actions/projects.ts`, add (place it near `scanForDraft` / the other Nextcloud actions):

```ts
export async function provisionProjectStructure(
  projectId: string,
  structure: "tree" | "final"
): Promise<ActionResult<{ path: string }>> {
  if (!projectId) {
    return { success: false, error: "Project is required." };
  }
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { folderName: true, title: true },
    });
    if (!project) {
      return { success: false, error: "Project not found." };
    }

    const folderName = getNextcloudFolderName(project);
    if (!folderName) {
      return { success: false, error: "Set a project/folder name before provisioning storage." };
    }

    const path = await provisionNextcloudFolder(folderName, structure);
    if (!path) {
      return { success: false, error: "Failed to provision Nextcloud folder. Check Nextcloud configuration." };
    }

    revalidatePath("/pipeline");
    return { success: true, data: { path } };
  } catch (err) {
    console.error("[provisionProjectStructure]", err);
    return { success: false, error: "Failed to provision project storage." };
  }
}
```

`provisionNextcloudFolder` is already imported in this file (line 10); `getNextcloudFolderName`,
`prisma`, `revalidatePath`, and the `ActionResult` type are already in scope (used by neighbouring
actions). If `ActionResult` is not generic in this codebase, return `ActionResult` without the
type argument and drop `data`.

**Verify**: `grep -n "export async function provisionProjectStructure" src/actions/projects.ts` → one match.

### Step 3: Document the env var

In projmgmt's `.env.example`, add under the `NEXTCLOUD_*` block:

```
# Comma-separated subfolders created when provisioning the "full project tree".
# Leave unset to use the default: Footage,Assets,SFX,Music,LUTs,VFX,Graphics,Exports,Drafts
NEXTCLOUD_PROJECT_SUBFOLDERS=""
```

**Verify**: `grep -n "NEXTCLOUD_PROJECT_SUBFOLDERS" .env.example` → one match.

### Step 4: Add the UI choice (bounded)

In `src/components/modals/ProjectDetailsModal.tsx`, locate where the project storage / folder name
is shown (search for `folderName`, `provision`, or `Nextcloud`/`storage` UI). Add two small
buttons (or a segmented control) — "Full tree" and "Final only" — that call the new action:

```tsx
import { provisionProjectStructure } from "@/actions/projects";
// ...
// inside an async handler, where `project.id` is available:
const res = await provisionProjectStructure(project.id, structure); // structure: "tree" | "final"
// surface res.error / res.success with the modal's existing toast/notice pattern
```

Match the modal's existing button styling and its existing pattern for calling a server action and
showing the result (find a sibling action call in this file, e.g. how `updatePlatformIds` or
`scanForDraft` results are handled, and copy that pattern). Keep it to a single, clearly-labelled
control near the folder/storage section.

**If you cannot confidently identify the storage/folder section** (the file is large and the
anchor is ambiguous): STOP and report. Do NOT scatter the control somewhere unrelated or refactor
the modal. The lib + action (Steps 1–2) are independently valuable and can ship while the UI
placement is decided by the maintainer.

**Verify**: `grep -n "provisionProjectStructure" src/components/modals/ProjectDetailsModal.tsx` → one match.

### Step 5: Typecheck + build

**Verify**:
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0

## Test plan

No unit-test harness; verify by typecheck + build + manual:

1. **Tree provisioning**: with Nextcloud configured, call `provisionProjectStructure(projectId, "tree")`
   (via the new UI control, or temporarily from a script). Confirm in Nextcloud the project folder
   now contains the subfolders from `getProjectSubfolders()`.
2. **Final-only**: call with `"final"` → only the top project folder is created (no subfolders).
3. **Idempotency**: run "tree" twice → no errors, no duplicate folders (the `exists` checks guard).
4. **Custom list**: set `NEXTCLOUD_PROJECT_SUBFOLDERS="Footage,Exports"` and provision "tree" →
   only those two subfolders are created.

If you cannot reach a Nextcloud server, complete the build gate and report that the live folder
checks were not executed.

## Done criteria

ALL must hold:

- [ ] `npx tsc --noEmit` exits 0 (in `/Users/neyako/projmgmt`)
- [ ] `npm run build` exits 0
- [ ] `grep -n "structure: \"tree\" | \"final\"" src/lib/nextcloud.ts` → match
- [ ] `grep -n "export async function provisionProjectStructure" src/actions/projects.ts` → match
- [ ] `grep -n "NEXTCLOUD_PROJECT_SUBFOLDERS" .env.example` → match, value blank
- [ ] UI control added in `ProjectDetailsModal.tsx` (or Step 4 STOP reported with reason)
- [ ] `updatePlatformIds` still calls `provisionNextcloudFolder(nextFolderName)` unchanged (default "final")
- [ ] Only in-scope projmgmt files changed (`git -C /Users/neyako/projmgmt status --porcelain`)
- [ ] `/Users/neyako/freeframed/plans/README.md` status row for 005 updated

## STOP conditions

Stop and report back if:

- `provisionNextcloudFolder` or `buildProjectPath` no longer exist / changed shape since projmgmt `1905a0b`.
- `buildProjectPath` cannot produce a nested `project/sub` path and the fallback in Step 1 also fails.
- The `ProjectDetailsModal.tsx` storage/folder anchor cannot be identified confidently (Step 4 escape).
- `npx tsc --noEmit` or `npm run build` fails for reasons in unrelated files (report; don't fix unrelated code).

## Maintenance notes

- The subfolder list is env-driven (`NEXTCLOUD_PROJECT_SUBFOLDERS`) with a sensible default; teams
  can tailor it without code changes. Keep the default in `DEFAULT_PROJECT_SUBFOLDERS` aligned with
  the team's actual asset taxonomy.
- Scaffolding is sequential and idempotent (`exists` before `createDirectory`). If project counts
  grow huge and provisioning feels slow, parallelise with `Promise.all` — but WebDAV servers can
  race on sibling mkdir, so test before changing.
- This plan intentionally provisions *structure* only. If the team later wants projmgmt to also
  upload the final export into the `Drafts`/`Exports` subfolder (instead of editors doing it via
  the Nextcloud client), that's a separate plan and overlaps with Plan 004's draft handling.
- Reviewer should scrutinise: existing `updatePlatformIds` behaviour is unchanged (still "final"),
  and the new action guards on missing folder name and missing Nextcloud config.
