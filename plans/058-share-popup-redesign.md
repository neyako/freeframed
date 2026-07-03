# Plan 058: Rebuild the share popup to the design's `ff-pop` spec (hairline rows, segmented access, red only on revoke)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 955feed..HEAD -- apps/web/components/review/share-dialog.tsx apps/web/components/review/share-link-controls.tsx apps/web/components/review/share-link-control-primitives.tsx apps/web/components/review/share-link-section.tsx apps/web/components/review/share-visibility-select.tsx apps/web/components/review/share-permission-select.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (share flow is user-critical; guest links must keep working)
- **Depends on**: 057 (soft — different files, but land 057 first so the
  popup's accent tints render during your visual check)
- **Category**: direction (design-system conformance)
- **Planned at**: commit `955feed`, 2026-07-03

## Why this matters

The share popup is the app's most-used outward-facing surface and currently
reads as "nine stacked boxes": every control sits in its own bordered card
with an icon tile, red is scattered across it, and the shell still carries a
dead `shadow-xl`. The maintainer designed a replacement in the FreeFrame
Design System (component 12, `share.dc.html` + the `.ff-pop` block of
`freeframe.css`): **one enclosure of hairline rows** — no icon tiles, each
label answered by its control in place, bilingual labels (EN primary, VI
secondary), and red appearing exactly once, on Revoke, at the end where a
destructive action belongs. All required primitives (`ui/switch`,
`ui/segmented`, `Button` variants) already exist from the retheme — this is
a restructure, not new machinery.

## Current state

All paths under `apps/web/`.

- `components/review/share-dialog.tsx` (136 lines) — `SharePanel`
  (link section + "Invite specific people" expander wrapping `DirectTab`)
  and `ShareDialog` (the trigger button + dropdown shell). Shell classes at
  lines 119–125:

  ```tsx
  <div
    className={cn(
      "fixed left-2 right-2 top-12 z-50 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-96",
      "max-h-[calc(100dvh-4.5rem)] sm:max-h-[min(calc(100dvh-8rem),42rem)] overflow-y-auto overscroll-contain",
      "rounded-xl border border-border bg-bg-elevated p-3 shadow-xl",
      "animate-in fade-in-0 zoom-in-95 duration-150 space-y-4",
    )}
  >
  ```

  The `fixed`/`sm:absolute` positioning and both `max-h`/`overflow`
  lines are plan-050's mobile-fit fix — **must survive**.

- `components/review/share-link-controls.tsx` (223 lines) — `LinkControls`:
  URL box, then `ControlRow`-wrapped Access (`PermissionSelect`), Visibility
  (`VisibilitySelect`), Allow download / Passphrase / Watermark
  (`SwitchControl`), Expiration (`<input type="date">`), Revoke (button +
  `ConfirmDialog`). Revoke button today (line ~202):

  ```tsx
  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-status-error/40 px-3 text-sm font-medium text-status-error transition-colors hover:bg-status-error/10 ..."
  ```

- `components/review/share-link-control-primitives.tsx` (109 lines) —
  `CopyButton` (ghost text button, "Copy"/"Copied!"), `ControlRow` (the
  boxed row with the 7×7 icon tile — the thing the design deletes),
  `SwitchControl` (hand-rolled switch, predates `ui/switch`).

- `components/review/share-link-section.tsx` (151 lines) —
  `SingleLinkSection`: fetch/create/patch/revoke state machine around
  `LinkControls`. Logic is correct; only its loading / "No share link"
  fallbacks need restyling.

- `components/review/share-permission-select.tsx` — permissions are
  `["view", "comment", "approve"]` (`SHARE_PERMISSIONS`, line 10), rendered
  as a Radix select. `components/review/share-visibility-select.tsx` —
  visibility `public | restricted` select.

- Existing primitives to reuse (created by plan 036/035, match the design
  1:1 — do NOT create new ones):
  - `components/ui/switch.tsx` — Radix-based `Switch`, design-spec track/knob.
  - `components/ui/segmented.tsx` — `Segmented` with
    `options/value/onChange/stretch` props; active option = mono uppercase,
    `bg-bg-primary` + `border-border-strong`.
  - `components/ui/button.tsx` — variants include `solid` (inverted mono)
    and `secondary`.
  - Tests exist: `components/__tests__/switch.test.tsx`, `segmented.test.tsx`.

- Consumers of `LinkControls`/`SharePanel` that inherit this restyle for
  free (verify they still render, do not restructure them):
  `components/review/share-bulk-panel.tsx`,
  `app/(dashboard)/projects/[id]/page.tsx` (project-page share dialog),
  `app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`.

### Design spec (inlined from the Claude Design project — executors have no access)

Source: project "FreeFrame Design System", `share.dc.html` + `.ff-pop` rules
in `freeframe.css`. Translate CSS to Tailwind tokens; all values below are
canonical:

- **Enclosure** (`ff-pop`): max-width 460px; `bg-bg-secondary`;
  1px `border-border` (– `--border-primary`); radius `--radius-xl` (= Tailwind
  `rounded-xl`); `overflow-hidden`; **no padding on the shell** — rows carry
  their own. No shadow.
- **Head** (`ff-pop__head`): row, `justify-between`, padding `14px 20px`,
  `border-b border-border`, `bg-bg-tertiary`. Title = mono 11px, uppercase,
  `tracking-[0.18em]`, `text-text-primary`: **"Share · Chia sẻ"**.
- **Link row** (`ff-pop__link`): padding `18px 20px`, `border-b
  border-border`. URL box (`ff-url`): flex-1 `min-w-0`, h-10, px-3,
  `bg-bg-primary border border-border rounded` (radius-md), link icon +
  `font-mono text-xs text-text-secondary truncate`. Beside it the Copy
  button: `Button variant="solid"` (mono-inverted), min-width 92px, label
  swaps "Copy" → "Copied" for ~1.8–2s.
- **Rows** (`ff-pop__row`): `flex items-center justify-between gap-4`,
  padding `14px 20px`, `border-b border-border-secondary` (hairline). Group
  separators (`ff-pop__row--group`, after Access and after Expiration) use
  `border-b border-border` instead. **No icon tiles anywhere.**
- **Labels** (`ff-pop__label`): stacked — EN `text-sm font-medium
  text-text-primary`; VI `text-xs text-text-secondary`. Pairs:
  - Access / Quyền truy cập
  - Visibility / Ai có thể mở liên kết
  - Allow download / Cho phép tải xuống
  - Passphrase / Yêu cầu mật khẩu khi mở
  - Watermark / Đóng dấu bản xem
  - Expiration / Ngày hết hạn
  - Revoke link / Vô hiệu hóa liên kết ngay lập tức
- **Access control**: a **segmented control** (use `ui/segmented`), not a
  select. Design mock shows View/Comment/Edit; the app's real values are
  `view | comment | approve` → labels **View / Comment / Approve**.
- **Visibility**: stays a select, restyled: h-[38px], `bg-bg-primary
  border border-border-strong rounded font-mono text-[11px] uppercase
  tracking-[0.08em]`; focus = `border-accent`, no ring.
- **Switches**: `ui/switch` for Allow download, Passphrase, Watermark.
- **Passphrase input** (shown only when the switch is on): compact input in
  its own strip below the row, container padding `0 20px 16px`; input
  h-[38px] w-full `font-mono text-xs`, placeholder
  "Nhập mật khẩu · passphrase".
- **Expiration**: compact `<input type="date">`, h-[38px] `font-mono
  text-xs`, same border treatment as the visibility select.
- **Invite expander** (`ff-pop__expander`): full-width row, padding
  `15px 20px`, `border-b border-border-secondary`, mono 11px uppercase
  `tracking-[0.16em] text-text-secondary hover:text-text-primary`, Users
  icon left, label **"Invite people · Mời"**, chevron right rotating 180°
  when open (`transition-transform`). Open content (`ff-pop__invite`):
  padding `16px 20px`, `border-b border-border-secondary`, contains the
  existing `DirectTab` unchanged.
- **Footer** (`ff-pop__foot`): `flex items-center justify-between`, padding
  `15px 20px`, no bottom border. Left = Revoke label pair; right = danger
  button (`ff-btn--danger`): `bg-transparent text-accent
  border border-accent-line rounded font-mono uppercase text-[11px]
  tracking-[0.08em] h-[34px] px-3.5`, hover `border-accent bg-accent-muted`.
  Label just **"Revoke"**. Keep the existing `ConfirmDialog` gate.
- **Red appears exactly once** in the closed popup: the Revoke button. (The
  head's status badge dot from the mock is optional — skip it; YAGNI.)

## Commands you will need

Run all in `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm exec tsc --noEmit` | 0 errors            |
| Tests     | `pnpm test`              | 0 failed            |
| Build     | `pnpm build`             | exit 0              |

Package manager is **pnpm only** — never `npm install` (see `AGENTS.md`).

## Scope

**In scope** (the only files you should modify):
- `components/review/share-dialog.tsx`
- `components/review/share-link-controls.tsx`
- `components/review/share-link-control-primitives.tsx`
- `components/review/share-link-section.tsx`
- `components/review/share-visibility-select.tsx` (className-only restyle)
- `components/review/share-permission-select.tsx` (may be reduced/deleted if
  Access moves to `Segmented`; if deleted, delete its usage cleanly)
- `components/review/__tests__/share-dialog.test.tsx`,
  `components/review/__tests__/share-dialog-dropdown.test.tsx` (update
  assertions), plus any new test file
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `components/review/share-direct-panel.tsx` (`DirectTab`) — rendered inside
  the expander **unchanged**; its internal conformance is deferred.
- `components/review/share-bulk-panel.tsx` and both dashboard pages — they
  consume `SharePanel`/`LinkControls` and inherit the restyle; verify render,
  don't edit.
- `components/review/share-link-requests.ts`, `share-targets.ts` — request
  logic and types are correct; no API/shape changes of any kind.
- `components/share/folder-share-viewer.tsx` — guest side, not this popup.
- `apps/api/**` — zero backend changes.

## Git workflow

- Branch: `advisor/058-share-popup-redesign`
- Conventional commits with scope, e.g.
  `feat(web): rebuild share popup to ff-pop spec (plan 058)`
- Do NOT push or open a PR.

## Steps

### Step 1: Rebuild the shell and head in `share-dialog.tsx`

Replace the dropdown container classes: keep line 121's positioning string
and line 122's max-h/overflow string **verbatim**; change the third line to
`"rounded-xl border border-border bg-bg-secondary overflow-hidden"` (drop
`p-3 shadow-xl`, drop `space-y-4`), widen `sm:w-96` → `sm:w-[460px]`, and
add the head bar as the first child:

```tsx
<div className="flex items-center justify-between gap-3 border-b border-border bg-bg-tertiary px-5 py-3.5">
  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-primary">
    Share · Chia sẻ
  </span>
</div>
```

`SharePanel` loses its `space-y-4` wrapper (rows now abut). Move the
"Invite specific people" expander styling to the design's
`ff-pop__expander` recipe (Step 4).

**Verify**: `pnpm exec tsc --noEmit` → 0 errors;
`grep -c "shadow-xl" components/review/share-dialog.tsx` → 0;
`grep -c "max-h-\[calc(100dvh-4.5rem)\]" components/review/share-dialog.tsx` → 1

### Step 2: Convert `LinkControls` rows to hairline rows

In `share-link-controls.tsx` + `share-link-control-primitives.tsx`:

- Rewrite `ControlRow` to the `ff-pop__row` recipe: container
  `flex items-center justify-between gap-4 px-5 py-3.5 border-b
  border-border-secondary`; new prop `group?: boolean` switches the border
  to `border-border`; label block renders the EN/VI pair (new
  `labelVi?: string` prop); **delete the icon tile** and the `icon` prop
  (drop the now-unused lucide imports in `share-link-controls.tsx`).
  Keep the `footer` slot (passphrase input strip) but render it full-width
  below the row with `px-5 pb-4` and **no** border of its own.
- Replace `SwitchControl`'s hand-rolled button with `ui/switch`'s `Switch`
  (`checked`, `onCheckedChange`, `disabled`, `aria-label`); keep the
  exported name/props so `share-link-controls.tsx` changes stay minimal.
- URL box + Copy: restyle per the Link-row spec; `CopyButton` becomes
  `Button variant="solid"` with `min-w-[92px]`, label "Copy"/"Copied"
  (keep the 2s reset timer and clipboard try/catch).
- Access: replace `PermissionSelect` usage with
  `Segmented` (`options={[{value:'view',label:'View'},{value:'comment',label:'Comment'},{value:'approve',label:'Approve'}]}`,
  `value={link.permission}`, `onChange={(permission) => onPatch({ permission })}`).
  Guard: if `link.permission` is ever outside the three values, fall back to
  rendering it as-is selected-none (do not crash).
- Visibility select, passphrase input, date input: apply the compact
  recipes from the design spec (mono, h-[38px], `bg-bg-primary`,
  `border-border-strong`, focus `border-accent` + `focus:outline-none`,
  no ring classes).
- Row order (top→bottom): URL row · Access (group border) · Visibility ·
  Allow download · Passphrase (+conditional input strip) · Watermark ·
  Expiration (group border). Revoke moves out of the row list into the
  footer (Step 3).

**Verify**: `pnpm exec tsc --noEmit` → 0 errors;
`grep -c "icon" components/review/share-link-control-primitives.tsx` → 0

### Step 3: Footer with the single red

Render the Revoke row as the last child (inside `LinkControls`, after the
rows, only when `showAdvancedControls && onRevoke`): `flex items-center
justify-between gap-4 px-5 py-[15px]` with **no** border-b; left = label
pair ("Revoke link" / "Vô hiệu hóa liên kết ngay lập tức"); right:

```tsx
<button
  type="button"
  onClick={() => setConfirmOpen(true)}
  disabled={saving}
  className="inline-flex h-[34px] items-center rounded border border-accent-line bg-transparent px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-accent transition-colors hover:border-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
>
  Revoke
</button>
```

Keep the `ConfirmDialog` exactly as is. Remove `status-error` classes from
this file (`text-status-error` on the error line may stay — it is the same
red token).

**Verify**: `grep -c "border-accent-line" components/review/share-link-controls.tsx` → 1

### Step 4: Expander + section fallbacks

- In `share-dialog.tsx`, restyle the invite toggle to `ff-pop__expander`:
  full-width `flex items-center justify-between px-5 py-[15px] border-b
  border-border-secondary font-mono text-[11px] uppercase tracking-[0.16em]
  text-text-secondary hover:text-text-primary transition-colors`; label
  "Invite people · Mời" with the existing Users icon; ChevronDown keeps its
  `rotate-180` open state. Open content wraps `DirectTab` in
  `px-5 py-4 border-b border-border-secondary`.
- In `share-link-section.tsx`, restyle the two fallbacks to sit inside the
  enclosure: loading row → `px-5 py-4` mono text; "No share link" card →
  borderless `px-5 py-4` block, its create button →
  `Button variant="secondary" size="sm"`.

**Verify**: `pnpm test` → 0 failed (fix assertions in Step 5 first if the
suite is already red from Steps 1–3 — then this gate is the final green)

### Step 5: Update tests

- `__tests__/share-dialog.test.tsx` / `share-dialog-dropdown.test.tsx`:
  update any class/text assertions broken by the restructure (e.g. the
  popup now contains "Share · Chia sẻ"; "Invite people · Mời" replaces
  "Invite specific people").
- Add assertions (extend an existing file or create
  `__tests__/share-link-controls.test.tsx`, modeled on
  `components/__tests__/segmented.test.tsx`):
  1. Access renders as a segmented control with View/Comment/Approve and
     clicking "Approve" calls `onPatch({ permission: 'approve' })`.
  2. Revoke button renders with `border-accent-line` and opens the confirm
     dialog (does not call `onRevoke` directly).
  3. Passphrase switch on → compact input appears; off → `onPatch({ password: "" })`.
  4. Copy button shows "Copied" after click (clipboard mocked).

**Verify**: `pnpm test` → 0 failed, total ≥ existing count + 4

### Step 6: Full gate + visual pass

`pnpm exec tsc --noEmit` → 0; `pnpm test` → 0 failed; `pnpm build` → exit 0.
If a dev stack is reachable (`http://localhost:3000`), open an asset, click
Share, and screenshot: single enclosure, hairline rows, no icon tiles,
segmented Access, red only on Revoke; check at a 390px-wide viewport that
the popup still fits and scrolls (plan-050 behavior). Also open the
project-page Share dialog (uses `SharePanel` via `projects/[id]/page.tsx`)
and confirm it renders.

## Test plan

See Step 5 — 4 new behavioral assertions; pattern files:
`components/__tests__/segmented.test.tsx` (interaction style),
`components/review/__tests__/share-dialog.test.tsx` (rendering style).
Full suite green is the gate; never weaken an existing assertion to pass —
update it to the new markup only when the markup change was specified here.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` → 0 errors
- [ ] `pnpm test` → 0 failed; the 4 new cases pass
- [ ] `pnpm build` → exit 0
- [ ] `grep -c "shadow-xl" components/review/share-dialog.tsx` → 0
- [ ] `grep -rc "ControlRow icon=" components/review/` → 0 matches in every file
- [ ] `grep -c "Segmented" components/review/share-link-controls.tsx` → ≥2 (import + usage)
- [ ] `grep -c "Share · Chia sẻ" components/review/share-dialog.tsx` → 1
- [ ] `grep -c "border-accent-line" components/review/share-link-controls.tsx` → 1
- [ ] Plan-050 anchors survive: `grep -c "max-h-\[calc(100dvh-4.5rem)\]" components/review/share-dialog.tsx` → 1
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The in-scope excerpts don't match the live code (drift).
- `ui/switch` or `ui/segmented` is missing or its props don't match the
  usage in Step 2 (would mean plan 036 was reverted).
- You need to change anything in `share-link-requests.ts`, `share-targets.ts`,
  or any API call shape to make the UI work.
- `share-bulk-panel.tsx` or a dashboard page fails to compile against the
  new `LinkControls`/`SharePanel` props — report the exact break instead of
  editing those files.
- An existing test asserts behavior (not markup) that the redesign would
  change — e.g. revoke firing without confirmation.

## Maintenance notes

- The EN/VI label pairs are hardcoded per the design ("native Vietnamese
  throughout"). If the app ever grows an i18n layer, these become its first
  extraction targets.
- `share-direct-panel.tsx` (invite internals) is deliberately unconformed —
  next candidate for a small follow-up plan.
- The design mock's head badge ("Live · v1" with blinking dot) was skipped
  as decoration; if the maintainer wants it, `components/shared/badge.tsx`
  already has `animate-blink`.
- 037 (chrome) and 039 (review surfaces) are DONE; nothing else claims these
  share files. Anything editing `share-dialog.tsx` later should preserve the
  plan-050 max-h/positioning strings noted in Step 1.
