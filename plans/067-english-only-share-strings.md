# Plan 067: English-only UI (strip hardcoded Vietnamese from share components)

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report — do not improvise. A reviewer maintains `plans/README.md`;
> do not edit it.
>
> **Drift check (run first)**:
> `git diff --stat a7d1e10..HEAD -- apps/web/components/review/share-dialog.tsx apps/web/components/review/share-link-controls.tsx apps/web/components/review/share-link-control-primitives.tsx`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: soft — round-8 branch `advisor/058-share-popup-redesign` touched
  these share files. If merged, re-verify the excerpts in the drift check.
- **Category**: polish / i18n
- **Planned at**: commit `a7d1e10`, 2026-07-04

## Why this matters

The share dialog and share-link controls ship **bilingual English·Vietnamese**
strings (a leftover from earlier prototyping). The maintainer wants the UI
English-only for now. A repo-wide scan confirms the Vietnamese is confined to
three share components + one test — everything else flagged as "Vietnamese" is
user-uploaded content (asset titles, burned-in subtitles), which is data, not UI,
and must NOT be touched.

## Current state (exact strings)

### `apps/web/components/review/share-dialog.tsx`
- Line 41: `Invite people · Mời`
- Line 130: `Share · Chia sẻ`

### `apps/web/components/review/share-link-controls.tsx`
- Line 112: `<ControlRow label="Access" labelVi="Quyền truy cập" group>`
- Line 130: `<ControlRow label="Visibility" labelVi="Ai có thể mở liên kết">`
- Line 139: `<ControlRow label="Allow download" labelVi="Cho phép tải xuống">`
- Line 151: `labelVi="Yêu cầu mật khẩu khi mở"`
- Line 164: `placeholder="Nhập mật khẩu · passphrase"`
- Line 180: `<ControlRow label="Watermark" labelVi="Đóng dấu bản xem">`
- Line 193: `<ControlRow label="Expiration" labelVi="Ngày hết hạn" group>`
- Line ~216: a Vietnamese caption `Vô hiệu hóa liên kết ngay lập tức` (read the
  surrounding lines ~213–218 for context — it describes a revoke/disable action).

### `apps/web/components/review/share-link-control-primitives.tsx`
The `ControlRow` component defines and renders the `labelVi` subtitle
(interface line 43 `readonly labelVi?: string;`, destructure line 51, render
lines 66–68):
```tsx
{labelVi && (
  <p className="mt-0.5 text-xs text-text-secondary">{labelVi}</p>
)}
```

### `apps/web/components/review/__tests__/share-dialog.test.tsx`
- Line 73: `expect(screen.getByText("Share · Chia sẻ")).toBeInTheDocument();`

### Repo conventions
- Presentation-only edits; keep every className, prop, and handler intact except
  the `labelVi` prop being removed.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**:
- `apps/web/components/review/share-dialog.tsx`
- `apps/web/components/review/share-link-controls.tsx`
- `apps/web/components/review/share-link-control-primitives.tsx`
- `apps/web/components/review/__tests__/share-dialog.test.tsx`

**Out of scope** (do NOT touch):
- Any asset title / comment / uploaded content (user data, often Vietnamese —
  leave it).
- Other share files, dialogs, or the review page.

## Git workflow

- Branch: `advisor/067-english-only-share-strings`
- Commit: `fix(web): English-only share UI, drop bilingual Vietnamese strings (plan 067)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: `share-dialog.tsx` — drop the `· <Vietnamese>` suffixes
- Line 41: `Invite people · Mời` → `Invite people`
- Line 130: `Share · Chia sẻ` → `Share`

**Verify**: `grep -c "·" apps/web/components/review/share-dialog.tsx` → `0`

### Step 2: `share-link-control-primitives.tsx` — remove the `labelVi` prop
- Delete `readonly labelVi?: string;` from `ControlRowProps` (line 43).
- Remove `labelVi,` from the destructure (line 51).
- Delete the render block (lines 66–68):
  ```tsx
  {labelVi && (
    <p className="mt-0.5 text-xs text-text-secondary">{labelVi}</p>
  )}
  ```

**Verify**: `grep -c "labelVi" apps/web/components/review/share-link-control-primitives.tsx` → `0`

### Step 3: `share-link-controls.tsx` — remove `labelVi` usages + Vietnamese text
- Remove the `labelVi="..."` attribute from every `<ControlRow>` (lines 112, 130,
  139, 151, 180, 193) — keep the `label="..."` and other props.
- Line 164: `placeholder="Nhập mật khẩu · passphrase"` → `placeholder="Passphrase"`.
- Line ~216: replace the Vietnamese caption with its English meaning (read the
  context; it describes disabling/revoking the link — use e.g.
  `Revoke this link immediately` or match the adjacent English label). If the line
  is a pure duplicate of an English string above it, delete the Vietnamese line.

**Verify**: `grep -c "labelVi" apps/web/components/review/share-link-controls.tsx` → `0`;
run `grep -nP "[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]" apps/web/components/review/share-link-controls.tsx`
→ no matches.

### Step 4: Fix the test
`share-dialog.test.tsx` line 73: `getByText("Share · Chia sẻ")` → `getByText("Share")`.

**Verify**: `grep -c "Chia sẻ\|·" apps/web/components/review/__tests__/share-dialog.test.tsx` → `0`

### Step 5: Gate
**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test. The existing `share-dialog.test.tsx` assertion is updated in Step 4.
Run `pnpm test` — any other assertion referencing the removed Vietnamese must be
updated to the English string (grep the test dir for `·` / Vietnamese first).

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -rlP "[àáảãạăâèéêìíòóôơùúưỳýđĐ]" apps/web/components/review/share-dialog.tsx apps/web/components/review/share-link-controls.tsx apps/web/components/review/share-link-control-primitives.tsx` → no matches
- [ ] `grep -rc "labelVi" apps/web/components/review` → all `0`
- [ ] Only in-scope files modified (`git status`)

## STOP conditions

- Excerpts don't match the live files (drift from 058 merge) — re-read first.
- A Vietnamese string turns out to be interpolated from user/API data (not a
  literal) — that's content, leave it and report.
- Removing `labelVi` breaks a type used outside these files — grep
  `labelVi` across `apps/web`; if used elsewhere, STOP.

## Maintenance notes

- If real internationalization is wanted later, do it with an i18n library and a
  locale file, not inline bilingual literals.
- Keep asset titles / comments / subtitles untouched — those are user content and
  may legitimately be any language.
