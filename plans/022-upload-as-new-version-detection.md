# Plan 022: Offer "upload as new version" when a dropped file matches an existing asset

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4d0c20f..HEAD -- "apps/web/app/(dashboard)/projects/[id]/page.tsx" apps/web/stores/upload-store.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (best after 014 — drag-drop — which already landed)
- **Category**: UX
- **Planned at**: commit `4d0c20f`, 2026-06-30

## Why this matters

Uploading version 2 of a clip is buried: the user must open the existing asset,
then click "New Version". When they instead drag a new cut onto the project grid
(or use the Upload dialog), it always creates a **separate asset** — so a project
ends up with "draft 1" and "draft 2" as unrelated items instead of one asset with
two versions, defeating the whole point of frame-accurate version review.

This plan makes the common case easy: when a single uploaded file's name matches
an existing asset in the current folder, ask once — "Upload as a new version of
'<asset>', or as a new asset?" — and route to the right upload path. The backend
already supports both (`startUpload` creates a new asset; `startVersionUpload`
adds a version), so this is purely a frontend detection + prompt.

## Current state

Files:
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` — project detail page. Holds
  the asset list (`assets`, SWR), the upload handlers, and several Radix dialogs
  to model the new prompt on.
- `apps/web/stores/upload-store.ts` — `useUploadStore`; exposes both
  `startUpload(file, projectId, assetName, projectName?, folderId?)` and
  `startVersionUpload(file, assetId, assetName, projectId)`.

The two upload entry points today (`…/projects/[id]/page.tsx`):

```tsx
// line 93 — only startUpload is destructured currently
const { files: uploadFiles, startUpload } = useUploadStore();

// line 290 — Upload dialog "Start upload"
const handleStartUpload = () => {
  pendingFiles.forEach((file) => {
    const name = pendingFiles.length === 1 ? assetName || file.name : file.name;
    startUpload(file, projectId, name, project?.name, currentFolderId);
  });
  setPendingFiles([]);
  setAssetName("");
  setUploadOpen(false);
};

// line 301 — drag-and-drop onto the grid
const handleDropFiles = React.useCallback(
  (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    files.forEach((file) => {
      const name = file.name.replace(/\.[^/.]+$/, "");
      startUpload(file, projectId, name, project?.name, currentFolderId);
    });
  },
  [startUpload, projectId, project?.name, currentFolderId],
);
```

The current-folder asset list is already loaded (`…/projects/[id]/page.tsx:163-170`):

```tsx
const { data: assets, isLoading: loadingAssets, mutate: mutateAssets } =
  useSWR<AssetResponse[]>(
    showTrash ? null : `/projects/${projectId}/assets?${folderParam}`,
    (key: string) => api.get<AssetResponse[]>(key),
  );
```

`startVersionUpload` (`apps/web/stores/upload-store.ts:252`):

```ts
startVersionUpload: (file, assetId, assetName, projectId) => { /* … POST /assets/{id}/versions … */ }
```

Existing dialog pattern to model the prompt on — the page already uses
`@radix-ui/react-dialog` (imported as `Dialog`, line 7) with this structure
(`…/projects/[id]/page.tsx:985-996`, the share dialog):

```tsx
<Dialog.Root open={activeShare !== null} onOpenChange={(open) => { if (!open) setActiveShare(null); }}>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm …" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-5 shadow-xl …">
      <Dialog.Title className="text-base font-semibold text-text-primary">…</Dialog.Title>
      …
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

`Button` is imported from `@/components/ui/button` (line 22). Types `AssetResponse`
imported (line 43-49). `cn`/`formatBytes` from `@/lib/utils` (line 20).

## Commands you will need

| Purpose   | Command                              | Expected on success   |
|-----------|--------------------------------------|-----------------------|
| Install   | `pnpm install`                       | exit 0                |
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors     |
| Lint      | `cd apps/web && pnpm lint`           | exit 0                |
| Tests     | `cd apps/web && pnpm test`           | all pass              |

## Scope

**In scope**:
- `apps/web/lib/version-match.ts` (create — pure matching function)
- `apps/web/lib/__tests__/version-match.test.ts` (create — unit tests)
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` (edit — wire detection + prompt)

**Out of scope** (do NOT touch):
- `apps/web/stores/upload-store.ts` — both upload functions already exist; only
  call `startVersionUpload`, do not change the store.
- `apps/web/components/projects/asset-grid.tsx` and the drag/drop handlers in the
  grid — the drop already calls `handleDropFiles`; only that handler changes.
- Any `apps/api/**` — backend versioning already works.
- Multi-file behavior — keep the existing "create N new assets" path for
  multi-file drops/selections (see step 3). Do not prompt per file.

## Git workflow

- Branch: `advisor/022-upload-version-detection`
- Conventional commits (e.g. `feat(web): offer new-version upload on name match`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write the pure matching helper

Create `apps/web/lib/version-match.ts`. Keep it tiny and deterministic — no React,
no store access. It normalizes a filename to a comparable "stem" and finds the
first asset whose name matches.

```ts
import type { AssetResponse } from '@/types'

/** Lowercase, strip extension, collapse whitespace, drop a trailing version marker. */
export function normalizeAssetName(raw: string): string {
  const noExt = raw.replace(/\.[^/.]+$/, '')
  return noExt
    .toLowerCase()
    .trim()
    .replace(/[\s_\-]*\(?v?\.?\s*\d+\)?$/i, '') // " v2", "_v2", "-2", " (3)", " 2"
    .trim()
}

/**
 * Returns the existing asset a newly uploaded file most likely supersedes,
 * or null. Match = identical normalized stem. Conservative on purpose: we'd
 * rather miss a match than wrongly fold two distinct clips into one asset.
 */
export function findVersionCandidate(
  fileName: string,
  assets: readonly AssetResponse[],
): AssetResponse | null {
  const stem = normalizeAssetName(fileName)
  if (!stem) return null
  return assets.find((a) => normalizeAssetName(a.name) === stem) ?? null
}
```

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Unit-test the helper

Create `apps/web/lib/__tests__/version-match.test.ts`, modelled on
`apps/web/lib/__tests__/utils.test.ts` (same vitest `describe`/`it`/`expect`
style, `globals: true`). Cover:
- `normalizeAssetName('Draft 1.mp4')` → `'draft'` and `normalizeAssetName('draft v2.mov')` → `'draft'` (version markers stripped).
- `normalizeAssetName('Hero Cut.mp4')` → `'hero cut'` (no false stripping of non-version words).
- `findVersionCandidate('hero cut v2.mp4', [{name:'Hero Cut', …}])` returns that asset.
- `findVersionCandidate('totally new.mp4', [{name:'Hero Cut', …}])` returns `null`.
- empty/extension-only name → `null`.

Build minimal `AssetResponse`-shaped fixtures (cast `as AssetResponse` with only
the fields the function reads — `name`, `id`).

**Verify**: `cd apps/web && pnpm test version-match` → new tests pass.

### Step 3: Wire detection into the two upload paths + add the prompt

In `apps/web/app/(dashboard)/projects/[id]/page.tsx`:

1. Destructure `startVersionUpload` from the store:
   ```tsx
   const { files: uploadFiles, startUpload, startVersionUpload } = useUploadStore();
   ```
2. Import the helper:
   ```tsx
   import { findVersionCandidate } from "@/lib/version-match";
   ```
3. Add state for the prompt:
   ```tsx
   const [versionPrompt, setVersionPrompt] =
     React.useState<{ file: File; candidate: AssetResponse } | null>(null);
   ```
4. Add a single-file helper that decides whether to prompt. Use it from BOTH
   `handleDropFiles` (single-file drop) and `handleStartUpload` (single-file
   dialog). For multiple files, keep the existing loop calling `startUpload`
   unchanged.
   ```tsx
   const startSmartUpload = React.useCallback(
     (file: File, name: string) => {
       const candidate = findVersionCandidate(file.name, assets ?? []);
       if (candidate) {
         setVersionPrompt({ file, candidate });
       } else {
         startUpload(file, projectId, name, project?.name, currentFolderId);
       }
     },
     [assets, startUpload, projectId, project?.name, currentFolderId],
   );
   ```
   - In `handleDropFiles`: if `files.length === 1`, call
     `startSmartUpload(files[0], files[0].name.replace(/\.[^/.]+$/, ""))`;
     else keep the existing `files.forEach(... startUpload ...)`.
   - In `handleStartUpload`: if `pendingFiles.length === 1`, call
     `startSmartUpload(pendingFiles[0], assetName || pendingFiles[0].name)` then
     reset (`setPendingFiles([]); setAssetName(""); setUploadOpen(false);`);
     else keep the existing loop.
5. Render the prompt dialog near the other dialogs (after the share dialog block).
   Two explicit choices + cancel:
   ```tsx
   <Dialog.Root open={versionPrompt !== null} onOpenChange={(open) => { if (!open) setVersionPrompt(null); }}>
     <Dialog.Portal>
       <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
       <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-5 shadow-xl">
         <Dialog.Title className="text-base font-semibold text-text-primary">
           Upload as a new version?
         </Dialog.Title>
         <Dialog.Description className="mt-1 text-sm text-text-secondary">
           “{versionPrompt?.file.name}” looks like a version of
           “{versionPrompt?.candidate.name}”.
         </Dialog.Description>
         <div className="mt-4 flex flex-col gap-2">
           <Button
             size="sm"
             onClick={() => {
               if (!versionPrompt) return;
               startVersionUpload(
                 versionPrompt.file,
                 versionPrompt.candidate.id,
                 versionPrompt.candidate.name,
                 projectId,
               );
               setVersionPrompt(null);
             }}
           >
             New version of “{versionPrompt?.candidate.name}”
           </Button>
           <Button
             variant="secondary"
             size="sm"
             onClick={() => {
               if (!versionPrompt) return;
               startUpload(
                 versionPrompt.file,
                 projectId,
                 versionPrompt.file.name.replace(/\.[^/.]+$/, ""),
                 project?.name,
                 currentFolderId,
               );
               setVersionPrompt(null);
             }}
           >
             Upload as a new asset
           </Button>
         </div>
       </Dialog.Content>
     </Dialog.Portal>
   </Dialog.Root>
   ```

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "startVersionUpload" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → ≥2 matches (destructure + call).

### Step 4: Lint + full test

**Verify**:
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → all pass.

## Test plan

- The matching logic is the risky part and is fully unit-tested in step 2
  (`version-match.test.ts`) — happy path, version-suffix forms, no-false-match,
  empty input.
- The dialog wiring is straightforward UI; manual check (note in PR): drop a
  file named like an existing asset → prompt appears; "New version" adds v2 to
  that asset (visible in the version switcher); "Upload as a new asset" creates a
  separate asset; a file with a unique name uploads with no prompt; dropping two
  files at once does not prompt.

Verification: `cd apps/web && pnpm test` → all pass, including the new tests.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0; `version-match.test.ts` passes
- [ ] `apps/web/lib/version-match.ts` exists and exports `findVersionCandidate` + `normalizeAssetName`
- [ ] Single-file drop/dialog of a name-matching file shows the prompt; multi-file
      drop does not (verified manually)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live code (drift).
- `startVersionUpload` is missing from `useUploadStore` or its signature differs
  from `(file, assetId, assetName, projectId)`.
- Detection would require fetching assets across folders or the backend — keep it
  to the already-loaded current-folder `assets`; if that's insufficient, STOP and
  report rather than adding new fetches.

## Maintenance notes

- The matcher is intentionally conservative (exact normalized-stem equality).
  If users want fuzzier matching (e.g. ignoring date suffixes), widen
  `normalizeAssetName` and add cases to its test — do not move logic into the
  component.
- A reviewer should confirm the multi-file path is untouched (no prompt storm)
  and that choosing "new asset" reproduces today's exact behavior.
- Deferred: detecting matches against assets in *other* folders, and auto-naming
  the version. Out of scope to keep the change small and predictable.
