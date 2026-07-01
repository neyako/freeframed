# Plan 031: Make the project "Upload" button open the native file picker directly instead of a modal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- "apps/web/app/(dashboard)/projects/[id]/page.tsx"`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

Clicking "Upload" on a project opens a modal ("Upload asset — Drag files and
folders to upload") with a second "Upload" button inside it — an extra click and
a redundant drop zone (the whole grid is already a drop target). Users expect the
button to open the OS file picker immediately. This plan wires the button to a
hidden file input that feeds the existing upload pipeline (which already handles
single-file "upload as new version" detection and multi-file uploads).

## Current state

File: `apps/web/app/(dashboard)/projects/[id]/page.tsx`

**Existing upload pipeline** — `handleDropFiles` (lines 327–344) already does
exactly what we want from a `FileList`: single file → smart upload (with version
detection from plan 022), multiple files → upload each:

```tsx
  const handleDropFiles = React.useCallback(
    (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      const [file] = files;
      if (files.length === 1 && file) {
        startSmartUpload(file, file.name.replace(/\.[^/.]+$/, ""));
        return;
      }

      files.forEach((droppedFile) => {
        const name = droppedFile.name.replace(/\.[^/.]+$/, "");
        startUpload(droppedFile, projectId, name, project?.name, currentFolderId);
      });
    },
    [startUpload, startSmartUpload, projectId, project?.name, currentFolderId],
  );
```

**The toolbar Upload button** (lines 732–737) currently opens the modal:

```tsx
                  {canUpload && (
                    <Button size="sm" onClick={() => setUploadOpen(true)}>
                      <Upload className="h-4 w-4" />
                      Upload
                    </Button>
                  )}
```

**The asset-grid empty-state uploader** also opens the modal (line ~596):

```tsx
              onUpload={() => setUploadOpen(true)}
```

The version-upload page already demonstrates the hidden-input pattern to copy
(`apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx:376-390`): a
`useRef<HTMLInputElement>`, a hidden `<input type="file">`, and
`ref.current?.click()`.

`useRef` is available via the page's React import. `handleDropFiles` is defined
before the JSX return, so it is in scope for the input's `onChange`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors   |
| Lint      | `cd apps/web && pnpm lint`           | exit 0              |
| Tests     | `cd apps/web && pnpm test`           | all pass            |

## Scope

**In scope** (the only file you should modify):
- `apps/web/app/(dashboard)/projects/[id]/page.tsx`

**Out of scope** (do NOT touch):
- `apps/web/components/upload/upload-zone.tsx` — still used by the (now
  unreachable) modal; leave it.
- The drag-and-drop overlay on the grid (lines ~479–507) — that already works;
  don't change it.
- `startUpload` / `startSmartUpload` / the upload store — reuse as-is.
- Do NOT delete the `<Dialog.Root open={uploadOpen} …>` block in this plan (see
  Maintenance notes — cleanup is a deferred follow-up to keep this change small
  and low-risk). Just stop opening it from the two buttons.

## Git workflow

- Branch: `advisor/031-upload-button-file-picker`
- Conventional commit, e.g. `feat(web): open native file picker from project Upload button`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a hidden multi-file input

Near the other refs at the top of the component (where `useRef` is already used),
add:

```tsx
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
```

Then render a hidden input inside the component's JSX (a good spot is just before
the existing `{/* Upload dialog */}` `Dialog.Root`), wired to the existing
`handleDropFiles`:

```tsx
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleDropFiles(e.target.files);
              e.target.value = "";
            }}
          />
```

**Verify**: `cd apps/web && grep -n "uploadInputRef" "app/(dashboard)/projects/[id]/page.tsx"` → at least two matches (ref decl + input + click handlers).

### Step 2: Point the toolbar Upload button at the picker

Change the toolbar button's `onClick`:

```tsx
                  {canUpload && (
                    <Button size="sm" onClick={() => uploadInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                      Upload
                    </Button>
                  )}
```

(If Plan 028 already wrapped the "Upload" label in `<span className="hidden sm:inline">`,
keep that wrapper; only the `onClick` changes.)

### Step 3: Point the empty-state uploader at the picker

Change the `onUpload` prop passed to the asset grid:

```tsx
              onUpload={() => uploadInputRef.current?.click()}
```

**Verify**: `cd apps/web && grep -n "setUploadOpen(true)" "app/(dashboard)/projects/[id]/page.tsx"` → no matches (both triggers replaced; the Dialog's own `onOpenChange`/`open` references to `uploadOpen` remain and are fine).

### Step 4: Full verification

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0 (no "unused setUploadOpen" — it is still used by the Dialog)
- `cd apps/web && pnpm lint` → exit 0
- `cd apps/web && pnpm test` → all pass

## Test plan

- No new unit test is strictly required (opening a native file dialog can't be
  asserted in jsdom), but if `apps/web/app/(dashboard)/projects/[id]/__tests__/`
  contains a test that clicks "Upload" expecting the modal to appear, update it to
  assert the hidden input is present / `handleDropFiles` is invoked instead.
- The existing `page-upload-drop.test.tsx` covers drag-drop → `handleDropFiles`;
  run it (`cd apps/web && pnpm test page-upload-drop`) and confirm it stays green
  (you reused `handleDropFiles`, so it should).
- Verification: `cd apps/web && pnpm test` → all pass.

## Done criteria

ALL must hold:

- [ ] `grep -n "setUploadOpen(true)" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → no matches
- [ ] `grep -n "uploadInputRef.current?.click()" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → two matches (toolbar + empty state)
- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] Only the one in-scope file is modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live file (drift since `30e5364`).
- Removing the `setUploadOpen(true)` triggers makes `setUploadOpen`/`uploadOpen`
  fully unused (it should still be referenced by the `Dialog.Root`); if lint/tsc
  reports them unused, that means the Dialog was already removed upstream — stop
  and report rather than deleting more.

## Maintenance notes

- Deferred follow-up (out of scope here): the `Dialog.Root open={uploadOpen}` +
  `UploadZone` + `pendingFiles`/`assetName` state + `handleFilesSelected`/
  `handleStartUpload` are now unreachable and can be removed in a dedicated
  cleanup commit once this behavior is confirmed. Kept for now to minimize risk.
- Reviewer should confirm: clicking Upload opens the OS picker; selecting one file
  that matches an existing asset still triggers the "upload as new version" prompt
  (plan 022 path via `startSmartUpload`); selecting multiple files uploads them
  all to the current folder.
