# Plan 014: Drag-and-drop upload onto the project grid (no separate upload panel needed)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. When done, update the status row for
> this plan in `plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- "apps/web/app/(dashboard)/projects/[id]/page.tsx" apps/web/stores/upload-store.ts`
> If `page.tsx` changed, compare the "Current state" excerpts before editing; on
> a mismatch, STOP.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`apps/web`)
- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (additive drag handlers on an existing page; reuses the existing upload action)
- **Depends on**: none
- **Category**: feature / UX
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

To upload today, a user clicks **Upload**, which opens a dialog (`setUploadOpen(true)`) where they then
pick or drag files. Dragging files straight onto the project grid does nothing. Users expect the
Dropbox/Drive behaviour: **drag files anywhere onto the project view and they upload to the current
folder** — no dialog round-trip. This plan adds a drop zone over the project content area that calls
the existing upload action directly, with a visual "Drop to upload" overlay while dragging. The
existing Upload button/dialog stays as a fallback (e.g. for mobile / file picker).

## Current state — `apps/web/app/(dashboard)/projects/[id]/page.tsx`

The page already has everything needed; it is only missing the drag handlers.

- The upload action (from the upload store, line ~119): `const { files: uploadFiles, startUpload } = useUploadStore();`
- Its signature (`apps/web/stores/upload-store.ts`):
  `startUpload(file: File, projectId: string, assetName: string, projectName?: string, folderId?: string | null) => string`
- The current dialog-based upload (lines ~351–362) shows the naming convention to reuse:

  ```tsx
  const handleStartUpload = () => {
    pendingFiles.forEach((file) => {
      const name = pendingFiles.length === 1 ? assetName || file.name : file.name;
      startUpload(file, projectId, name, project?.name, currentFolderId);
    });
    ...
  };
  ```

- `currentFolderId` (the folder being viewed) and `project?.name` are in scope on this component.
- The grid is rendered as `<AssetGrid … />` (line ~719) inside the page's main content container.

### Conventions

- Tailwind + `cn()`; `lucide-react` icons (use `UploadCloud` for the overlay — add to the import if
  absent). React state via `React.useState`.
- Match the file→asset name rule: strip the extension, i.e. `file.name.replace(/\.[^/.]+$/, "")`
  (used at line ~348).

## Commands you will need

| Purpose | Command (repo root) | Expected |
|---------|---------------------|----------|
| Install web deps | `cd apps/web && pnpm install --frozen-lockfile` | exit 0 |
| Build | `cd apps/web && pnpm build` | exit 0 |
| Anchor greps | see Done criteria | matches |

Quote the path: `"apps/web/app/(dashboard)/projects/[id]/page.tsx"`.

## Scope

**In scope** (one file): `apps/web/app/(dashboard)/projects/[id]/page.tsx` — add drag state, drag
handlers on the main content container, a drop overlay, and a `handleDropFiles` that calls
`startUpload` per file.

**Out of scope**:
- `apps/web/stores/upload-store.ts` — use `startUpload` as-is; do not change the store.
- The existing Upload dialog / `handleStartUpload` — leave it as the fallback path.
- Folder-targeting beyond `currentFolderId` (drag onto a *specific* folder card is a separate feature;
  here all drops go to the currently-open folder, matching the existing dialog behaviour).
- The asset-grid component itself (`components/projects/asset-grid.tsx`).

## Git workflow

- Branch: `advisor/014-drag-and-drop-upload`
- Conventional commit (e.g. `feat(web): drag-and-drop upload onto the project grid`).
- Do NOT push unless instructed.

## Steps

### Step 1: Add drag state + a file-drop handler

Near the other `React.useState` declarations on the component, add:

```tsx
  const [isDraggingFiles, setIsDraggingFiles] = React.useState(false);
  const dragDepth = React.useRef(0); // count nested dragenter/leave so the overlay doesn't flicker

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

**Verify**: `grep -n "handleDropFiles" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → ≥ 2 matches.

### Step 2: Wire drag handlers onto the main content container

Find the element that wraps the page's main content (the container that holds the `<AssetGrid … />` at
line ~719 — typically a `<div className="flex-1 …">` or the page's scroll container). Add drag handlers
+ `position: relative` so the overlay can be absolutely positioned over it. Add these props to that
container's opening tag:

```tsx
        onDragEnter={(e) => {
          if (!e.dataTransfer?.types?.includes('Files')) return
          e.preventDefault()
          dragDepth.current += 1
          setIsDraggingFiles(true)
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setIsDraggingFiles(false)
        }}
        onDrop={(e) => {
          if (!e.dataTransfer?.types?.includes('Files')) return
          e.preventDefault()
          dragDepth.current = 0
          setIsDraggingFiles(false)
          handleDropFiles(e.dataTransfer.files)
        }}
```

Ensure that container has `relative` in its className (add it if missing) so Step 3's overlay anchors to
it. **If you cannot identify a single clear content container** (the JSX nests differently than
described), STOP and report the structure rather than guessing — wiring drop onto the wrong element
breaks scrolling.

**Verify**: `grep -n "onDrop={(e) =>" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → match.

### Step 3: Render the drop overlay

Inside that same content container (as the first child, so it overlays the grid), add:

```tsx
        {isDraggingFiles && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm border-2 border-dashed border-accent rounded-lg pointer-events-none">
            <div className="flex flex-col items-center gap-3 text-center">
              <UploadCloud className="h-10 w-10 text-accent" />
              <p className="text-sm font-medium text-text-primary">Drop files to upload</p>
              <p className="text-xs text-text-tertiary">
                They’ll be added to {currentFolderId ? 'this folder' : 'the project root'}.
              </p>
            </div>
          </div>
        )}
```

Import `UploadCloud` from `lucide-react` if it is not already imported.

**Verify**: `grep -n "Drop files to upload" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → match.

### Step 4: Build

**Verify**: `cd apps/web && pnpm install --frozen-lockfile && pnpm build` → exit 0. If unrunnable, rely
on the grep anchors + a manual check and say so.

## Test plan

- **Automated gate**: Step 1–3 grep anchors + clean `pnpm build`.
- **Manual (if you can run it)**:
  1. Open a project. Drag a video file from the OS over the grid → the **“Drop files to upload”**
     overlay appears.
  2. Drop it → the upload starts (it shows in the uploads panel/progress just like the dialog path) and
     the asset appears in the current folder when processing completes.
  3. Drag-leave without dropping → the overlay disappears (no flicker over nested cards).
  4. The existing **Upload** button still opens the dialog (fallback unaffected).

## Done criteria

ALL must hold (greps from repo root, path quoted):

- [ ] `grep -c "handleDropFiles" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → ≥ 2
- [ ] `grep -n "onDrop={(e) =>" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → match
- [ ] `grep -n "Drop files to upload" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → match
- [ ] `cd apps/web && pnpm build` exits 0 (or manual check recorded)
- [ ] Only `apps/web/app/(dashboard)/projects/[id]/page.tsx` changed (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

Stop and report if:

- `startUpload`'s signature in `upload-store.ts` differs from the "Current state" excerpt (the call
  would be wrong).
- There is no single content container to attach the handlers to without breaking the layout/scroll —
  report the JSX structure instead of forcing it.
- Drag-and-drop would require changing the upload store or asset grid — that is out of scope; report it.

## Maintenance notes

- Drops target `currentFolderId` (the open folder), matching the dialog. Per-folder-card drop targeting
  (drop onto a specific folder thumbnail to upload there) is a deliberate follow-up — the asset grid
  already has folder drop handlers for *moving* assets (`onDropToFolder`); uploading-into-a-folder would
  extend that.
- The `dragDepth` ref counter prevents the overlay flickering as the cursor crosses nested child
  elements (each fires dragenter/leave). Keep it if you refactor.
- `window`-level drag listeners were avoided on purpose so dropping a file *outside* the project view
  (e.g. on the nav) doesn't trigger an upload.
