# Plan 004: projmgmt → FreeFrame review bridge (mint a guest link on Editing→Review)

> **Executor instructions**: This plan modifies the **projmgmt** repository, NOT
> the repo these plan files live in. Work in `/Users/neyako/projmgmt`. Follow the
> steps in order, run every verification, and honor STOP conditions. When done,
> update the status row for this plan in
> `/Users/neyako/freeframed/plans/README.md`.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/projmgmt diff --stat 1905a0b..HEAD -- src/actions/projects.ts src/lib/nextcloud.ts`
> Compare the "Current state" excerpts against the live code on any change; on a
> mismatch, treat it as a STOP condition.

## Status

- **Target repo**: projmgmt — `/Users/neyako/projmgmt`
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/002-reviewer-safe-share.md, plans/003-review-ingest-endpoint.md
  (both must be deployed on a reachable FreeFrame instance for end-to-end verification)
- **Category**: feature (integration)
- **Planned at**: projmgmt commit `1905a0b`, 2026-06-28

## Why this matters

projmgmt is the production control room. Its workflow gate `Editing → Review` requires a
`reviewLink`, which today is a raw Nextcloud file URL — no frame-accurate comments, no
annotations, and (the reviewer's real complaint) it can expose more than the one file. The
decided architecture makes FreeFrame the review engine: when a draft is ready, projmgmt should
push **only that final video** to FreeFrame and store the returned **reviewer-safe guest link**
in `reviewLink`. Reviewers then watch exactly one video with frame-accurate commenting and never
see the project's other assets, which live in Nextcloud/NAS. This plan wires projmgmt's existing
`scanForDraft` seam to FreeFrame's ingest endpoint (Plan 003), with a clean fallback to the old
Nextcloud-link behaviour when FreeFrame is not configured.

## Current state

### `src/actions/projects.ts` — the seam: `scanForDraft` (lines 547–590)

```ts
export async function scanForDraft(
  projectId: string,
  projectName: string
): Promise<{ success: true; link: string; version: number } | { success: false; error: string }> {
  if (!projectId) {
    return { success: false, error: "Project is required before scanning Nextcloud." };
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { draftVersion: true, folderName: true, title: true },
    });

    if (!project) {
      return { success: false, error: "Project not found." };
    }

    const scanProjectName = getNextcloudFolderName(project) || projectName.trim();

    if (!scanProjectName) {
      return { success: false, error: "Project name is required before scanning Nextcloud." };
    }

    const newLink = await generateDraftReviewLink(scanProjectName, project.draftVersion);

    if (!newLink) {
      return { success: false, error: "No draft file detected in Nextcloud yet." };
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { reviewLink: newLink },
    });

    revalidatePath("/pipeline");
    revalidatePath("/archive");

    return { success: true, link: newLink, version: project.draftVersion };
  } catch (err) {
    console.error("[scanForDraft]", err);
    return { success: false, error: "Failed to scan Nextcloud drafts." };
  }
}
```

`generateDraftReviewLink` and `provisionNextcloudFolder` are imported at the top of
`projects.ts` from `../lib/nextcloud` (the import list around line 9 includes
`generateDraftReviewLink`). `getNextcloudFolderName` is a local helper (line 149):
`project.folderName?.trim() || project.title`.

### `src/lib/nextcloud.ts` — Nextcloud access (already present)

Uses the `webdav` package (`createClient`). Module-private helpers you will reuse:
- `getNextcloudConfig()` → `{ baseUrl, username, password, basePath, webDavUrl, ... } | null`
- `getWebDavClient(config)` → cached `WebDAVClient`
- `resolveProjectDirectory(client, basePath, projectName)` → `{ path } | null` (line 130)
- `matchesDraftVersion(fileName, currentVersion)` (line 121)
- `generateDraftReviewLink(projectName, currentVersion)` (line 200) — locates the draft file and
  returns a Nextcloud internal `/f/{fileId}` link. **This is the pattern to copy** for locating
  the draft, but you will return the file *bytes* instead of a link.

The draft is found by: resolve the project directory, list its contents with details, filter
`item.type === "file" && matchesDraftVersion(item.basename, expectedVersion)`, pick the
newest. (See lines 222–241.)

### Environment (`.env.example`)

Currently defines `NEXTCLOUD_*`, `NAS_*`, etc. There are **no** FreeFrame variables yet.

### Runtime facts

- projmgmt is Next.js 15 on Node ≥ 18, so global `fetch`, `FormData`, and `Blob` are available
  in server actions (`"use server"` modules). No new HTTP dependency is needed.
- The `webdav` client's `getFileContents(path, { format: "binary" })` returns a `Buffer`.

**Conventions:**
- Server actions live in `src/actions/*.ts`, are `"use server"`, return a discriminated
  `{ success: true, ... } | { success: false, error }` result, and `console.error("[fnName]", err)`
  on failure. Match `scanForDraft` exactly.
- Integration clients live in `src/lib/*.ts` (see `src/lib/nextcloud.ts`). Read env via
  `process.env.*` with a `getXConfig()` guard that returns `null` when unconfigured, logging a
  `console.warn("[Name] Missing configuration: ...")` — mirror `getNextcloudConfig()`.
- AGENTS.md note: do NOT add new mutation flows under `src/app/api/*`; use server actions
  (`src/actions`). This plan adds a lib + extends a server action — correct per that rule.

## Commands you will need

| Purpose | Command (from `/Users/neyako/projmgmt`) | Expected |
|---------|------------------------------------------|----------|
| Install | `npm install` | exit 0 (deps already present) |
| Typecheck | `npx tsc --noEmit` | exit 0, no new errors |
| Build | `npm run build` | exit 0 |

projmgmt has no unit-test runner configured (no `test` script in `package.json`), so verification
is typecheck + build + the manual end-to-end check in the Test plan. Do not introduce a test
framework for this plan.

## Scope

**In scope** (in `/Users/neyako/projmgmt`):
- `src/lib/nextcloud.ts` — add exported `getDraftFile(projectName, currentVersion)`.
- `src/lib/freeframe.ts` (create) — FreeFrame ingest client.
- `src/actions/projects.ts` — extend `scanForDraft` to push to FreeFrame when configured, else
  fall back to `generateDraftReviewLink`.
- `.env.example` — add `FREEFRAME_*` placeholders.

**Out of scope**:
- The FreeFrame repo — it is handled by Plans 002/003. Do not edit `/Users/neyako/freeframed`
  here except the `plans/README.md` status row at the end.
- `submitReview`, `updateProjectStatus`, the reject/`draftVersion`-increment logic — leave as is.
- Prisma schema — no DB change; `reviewLink` is reused. If you think a new column is needed, STOP.
- Any UI component — the existing "scan for draft" button calls `scanForDraft`; its behaviour
  improves transparently. Do not redesign the UI in this plan.

## Git workflow

- Branch (in projmgmt): `feat/freeframe-review-bridge`
- projmgmt uses plain commit messages; keep it conventional, e.g.
  `feat: push draft to FreeFrame for review when configured`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `getDraftFile` to `src/lib/nextcloud.ts`

Add an exported async function that locates the current draft (same logic as
`generateDraftReviewLink`) but returns its bytes, filename, and a guessed MIME type. Place it
near `generateDraftReviewLink`. Reuse the module-private `getNextcloudConfig`,
`getWebDavClient`, `resolveProjectDirectory`, `matchesDraftVersion`, `getFileModifiedTime`.

```ts
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

export async function getDraftFile(
  projectName: string,
  currentVersion: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  const config = getNextcloudConfig();
  const cleanProjectName = projectName.trim();
  const expectedVersion = Math.max(1, Math.floor(currentVersion));

  if (!config || !cleanProjectName || !Number.isFinite(currentVersion)) {
    return null;
  }

  const client = getWebDavClient(config);

  try {
    const projectDirectory = await resolveProjectDirectory(client, config.basePath, cleanProjectName);
    if (!projectDirectory) return null;

    const contentsResponse = await client.getDirectoryContents(projectDirectory.path, {
      details: true,
    });
    const contents = contentsResponse.data;
    const draft = contents
      .filter((item) => item.type === "file" && matchesDraftVersion(item.basename, expectedVersion))
      .sort((a, b) => getFileModifiedTime(b) - getFileModifiedTime(a))[0];

    if (!draft) return null;

    const ext = (draft.basename.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
    const mime = VIDEO_MIME_BY_EXT[ext] ?? "video/mp4";
    const data = await client.getFileContents(draft.filename, { format: "binary" });
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

    return { buffer, filename: draft.basename, mime };
  } catch (error) {
    console.error(`[Nextcloud] Failed to fetch draft file for "${cleanProjectName}".`, error);
    return null;
  }
}
```

If `resolveProjectDirectory`, `matchesDraftVersion`, or `getFileModifiedTime` are not in scope at
that point in the file (e.g. declared after this function), move `getDraftFile` below their
definitions. They are all defined above line 250, so placing `getDraftFile` after
`generateDraftReviewLink` (line ~255) is safe.

**Verify**: `grep -n "export async function getDraftFile" src/lib/nextcloud.ts` → one match.

### Step 2: Create the FreeFrame client `src/lib/freeframe.ts`

```ts
type FreeFrameConfig = {
  apiUrl: string;
  apiKey: string;
  projectId: string;
};

function getFreeFrameConfig(): FreeFrameConfig | null {
  const apiUrl = process.env.FREEFRAME_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.FREEFRAME_API_KEY;
  const projectId = process.env.FREEFRAME_PROJECT_ID;

  if (!apiUrl || !apiKey || !projectId) {
    return null; // FreeFrame integration disabled — caller falls back.
  }
  return { apiUrl, apiKey, projectId };
}

export function isFreeFrameConfigured(): boolean {
  return getFreeFrameConfig() !== null;
}

/**
 * Push a draft video to FreeFrame and return a reviewer-safe guest link.
 * Returns null when FreeFrame is not configured or the call fails (caller falls back).
 */
export async function pushDraftForReview(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
  assetName: string;
  permission?: "view" | "comment" | "approve";
  allowDownload?: boolean;
}): Promise<{ url: string; token: string } | null> {
  const config = getFreeFrameConfig();
  if (!config) return null;

  try {
    const form = new FormData();
    form.append("project_id", config.projectId);
    form.append("asset_name", input.assetName);
    form.append("mime_type", input.mime);
    form.append("permission", input.permission ?? "comment");
    form.append("allow_download", String(input.allowDownload ?? false));
    form.append(
      "file",
      new Blob([input.buffer], { type: input.mime }),
      input.filename
    );

    const res = await fetch(`${config.apiUrl}/integrations/review-ingest`, {
      method: "POST",
      headers: { "X-Api-Key": config.apiKey },
      body: form,
    });

    if (!res.ok) {
      console.error(`[FreeFrame] review-ingest failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as { url?: string; token?: string };
    if (!data.url || !data.token) {
      console.error("[FreeFrame] review-ingest returned no url/token", data);
      return null;
    }
    return { url: data.url, token: data.token };
  } catch (error) {
    console.error("[FreeFrame] review-ingest request error", error);
    return null;
  }
}
```

**Verify**: `npx tsc --noEmit` → exit 0 (confirms `FormData`/`Blob`/`fetch` types resolve under
the project's TS config; if `Blob`/`FormData` are flagged as missing, see STOP conditions).

### Step 3: Wire FreeFrame into `scanForDraft`

In `src/actions/projects.ts`, add to the existing nextcloud import (line ~9) the new helper, and
add a FreeFrame import:

```ts
import {
  // ...existing imports...
  generateDraftReviewLink,
  getDraftFile,
} from "../lib/nextcloud";
import { isFreeFrameConfigured, pushDraftForReview } from "../lib/freeframe";
```

Then replace the link-resolution block inside `scanForDraft` (the lines from
`const newLink = await generateDraftReviewLink(...)` through the `prisma.project.update(... reviewLink: newLink ...)` and the `return { success: true, link: newLink, ... }`) with:

```ts
    let newLink: string | null = null;

    if (isFreeFrameConfigured()) {
      // Preferred path: push the draft video into FreeFrame for frame-accurate review.
      const draft = await getDraftFile(scanProjectName, project.draftVersion);
      if (!draft) {
        return { success: false, error: "No draft file detected in Nextcloud yet." };
      }
      const review = await pushDraftForReview({
        buffer: draft.buffer,
        filename: draft.filename,
        mime: draft.mime,
        assetName: `${scanProjectName} — draft v${project.draftVersion}`,
        permission: "comment",
      });
      if (!review) {
        return { success: false, error: "Failed to create FreeFrame review link. Check FreeFrame service and API key." };
      }
      newLink = review.url;
    } else {
      // Fallback: legacy Nextcloud internal file link.
      newLink = await generateDraftReviewLink(scanProjectName, project.draftVersion);
      if (!newLink) {
        return { success: false, error: "No draft file detected in Nextcloud yet." };
      }
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { reviewLink: newLink },
    });

    revalidatePath("/pipeline");
    revalidatePath("/archive");

    return { success: true, link: newLink, version: project.draftVersion };
```

Leave everything else in `scanForDraft` (the project lookup, `scanProjectName` derivation, the
`catch`) unchanged.

**Verify**:
- `grep -n "pushDraftForReview" src/actions/projects.ts` → one match.
- `grep -n "isFreeFrameConfigured" src/actions/projects.ts` → one match.

### Step 4: Document the env vars

In projmgmt's `.env.example`, add after the `NEXTCLOUD_*` block:

```
# FreeFrame review service (companion app). When all three are set, projmgmt pushes the
# draft video to FreeFrame on "scan for draft" and stores the reviewer guest link in reviewLink.
# Leave blank to keep using legacy Nextcloud review links.
FREEFRAME_API_URL=""
FREEFRAME_API_KEY=""
FREEFRAME_PROJECT_ID=""
```

`FREEFRAME_API_KEY` must equal the FreeFrame server's `INTEGRATION_API_KEY` (Plan 003).
`FREEFRAME_PROJECT_ID` is the UUID of the FreeFrame project that holds review assets (create one
in FreeFrame and copy its id). **Never** put a real key in `.env.example`.

**Verify**: `grep -n "FREEFRAME_API_URL" .env.example` → one match, value blank.

### Step 5: Typecheck + build

**Verify**:
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0

## Test plan

projmgmt has no unit-test harness; verify by typecheck + build + manual end-to-end:

1. **Unconfigured fallback (no FreeFrame env)**: with `FREEFRAME_*` blank, `scanForDraft` behaves
   exactly as before — stores a Nextcloud link. Confirm by reading the code path and (optionally)
   running the app and clicking "scan for draft" on a project with a draft in Nextcloud.
2. **Configured happy path** (requires a running FreeFrame with Plans 002+003 deployed and a
   FreeFrame project created): set the three `FREEFRAME_*` vars, put a `draft 1 - <project>` video
   in the project's Nextcloud folder, click "scan for draft". Expect `reviewLink` to become a
   `…/share/<token>` FreeFrame URL; opening it shows the single video with guest commenting and
   no other assets.
3. **FreeFrame down**: with `FREEFRAME_*` set but the service unreachable, `scanForDraft` returns
   the "Failed to create FreeFrame review link" error and does **not** overwrite `reviewLink`.

If you cannot stand up a FreeFrame instance, complete cases #1 and #3 reasoning + the build gate,
and clearly report that #2 was not executed end-to-end.

## Done criteria

ALL must hold:

- [ ] `npx tsc --noEmit` exits 0 (in `/Users/neyako/projmgmt`)
- [ ] `npm run build` exits 0
- [ ] `grep -n "export async function getDraftFile" src/lib/nextcloud.ts` → match
- [ ] `src/lib/freeframe.ts` exists and exports `isFreeFrameConfigured` + `pushDraftForReview`
- [ ] `grep -n "pushDraftForReview" src/actions/projects.ts` → match
- [ ] `grep -n "FREEFRAME_API_URL" .env.example` → match, value blank
- [ ] With `FREEFRAME_*` unset, the legacy `generateDraftReviewLink` path is still taken (fallback intact)
- [ ] Only the four in-scope projmgmt files changed (`git -C /Users/neyako/projmgmt status --porcelain`)
- [ ] `/Users/neyako/freeframed/plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back if:

- `scanForDraft` no longer exists or its shape changed materially since projmgmt `1905a0b`.
- `resolveProjectDirectory` / `matchesDraftVersion` / `getNextcloudConfig` are not present in
  `src/lib/nextcloud.ts` (the file was refactored) — `getDraftFile` depends on them.
- `npx tsc --noEmit` flags `FormData`/`Blob`/`fetch` as undefined types: the project's
  `tsconfig.json` `lib`/`types` may need `"DOM"` or `@types/node` ≥ 18 globals. Do NOT broaden the
  tsconfig blindly; report the exact error so the maintainer decides (e.g. cast via
  `globalThis.FormData`).
- The draft video routinely exceeds memory when buffered (multi-GB drafts) — note it; the v1
  contract buffers the file (see Maintenance). If this is a blocker for real drafts, STOP and
  report so a streaming upload is planned instead.

## Maintenance notes

- **Memory**: `getDraftFile` buffers the whole draft into a `Buffer` before posting. Fine for
  typical edit drafts; for very large files, switch to a streamed `fetch` body (Node `Readable`
  → `fetch` duplex, or a presigned-URL handshake with FreeFrame). Deferred to keep v1 simple.
- **Asset naming**: drafts are pushed as a *new* FreeFrame asset named
  `"<project> — draft v<N>"`. On reject, projmgmt increments `draftVersion` (existing behaviour),
  so the next scan creates `draft v<N+1>` — a fresh FreeFrame asset/link. If you later want
  reviewers to see version history within FreeFrame, extend Plan 003's endpoint to accept an
  `asset_id` and store the FreeFrame asset id on the projmgmt `Project` (new column).
- **Fallback is load-bearing**: keep the `isFreeFrameConfigured()` guard so teams without
  FreeFrame keep working. Don't remove the `generateDraftReviewLink` branch.
- Reviewer should scrutinise: `reviewLink` is only overwritten on success (never clobbered to a
  bad value when FreeFrame errors), and the API key is read server-side only (never shipped to the
  browser — this is a server action, so it stays server-side; do not move this into a client
  component).
