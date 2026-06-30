# Plan 023: Simplify the share popup — collapse people-invite behind progressive disclosure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4d0c20f..HEAD -- apps/web/components/review/share-dialog.tsx apps/web/components/review/share-direct-panel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (builds on 015/019 single-link share, already landed)
- **Category**: UX
- **Planned at**: commit `4d0c20f`, 2026-06-30

## Why this matters

The share popup now shows a wall of controls at once (screenshot): "Anyone with
the link" + permission, the URL + copy, "Allow download", then a full "Share with
people" block — share-with-user (email + permission + button), share-with-team
(select + permission + button), and a current-shares list. For the 90% case —
"copy a link and send it" — this is overwhelming. The fix is progressive
disclosure: show the link essentials by default and tuck the specific-people
invite flow behind a single "Invite specific people" toggle, collapsed by
default. No behavior is removed; it's one click away.

## Current state

The component that composes the popup (`apps/web/components/review/share-dialog.tsx:21-42`):

```tsx
export function SharePanel({
  target,
  projectId,
  withPeople = false,
}: SharePanelProps) {
  const peopleTarget: PeopleShareTarget | null =
    target.kind === "project" ? null : target;

  return (
    <div className="space-y-4">
      <SingleLinkSection target={target} />
      {withPeople && peopleTarget && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-text-secondary">
            Share with people
          </p>
          <DirectTab target={peopleTarget} orgId={projectId} />
        </div>
      )}
    </div>
  );
}
```

- `SingleLinkSection` (in `share-link-section.tsx`) renders `LinkControls`: the
  "Anyone with the link" row + permission select, the URL + Copy, and the "Allow
  download" checkbox. **Keep this visible by default** — it's the Drive-style core.
- `DirectTab` (in `share-direct-panel.tsx`) renders the entire "share with user",
  "share with team", and "current shares" UI — this is the bulk of the noise.
  **Collapse this** behind a toggle.

`SharePanel` is used by:
- `ShareDialog` (asset top-bar dropdown, `share-dialog.tsx:107-111`) with `withPeople`.
- The project page's share dialog (`apps/web/app/(dashboard)/projects/[id]/page.tsx:1020-1033`)
  for folder/asset shares with `withPeople`.
(`BulkSharePanel` and `SingleLinkSection`-only project shares are already minimal — not in scope.)

Repo conventions: design tokens `text-text-*` / `bg-bg-*` / `border-border`;
icons from `lucide-react` (`Users`, `ChevronDown` available); `cn` from
`@/lib/utils`. There is an existing test `apps/web/components/review/__tests__/share-dialog.test.tsx`
with fixtures `share-dialog.fixtures.ts` — read them to match the test style and
to see how `SharePanel`/`DirectTab` are already exercised.

## Commands you will need

| Purpose   | Command                              | Expected on success   |
|-----------|--------------------------------------|-----------------------|
| Install   | `pnpm install`                       | exit 0                |
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors     |
| Lint      | `cd apps/web && pnpm lint`           | exit 0                |
| Tests     | `cd apps/web && pnpm test`           | all pass              |

## Scope

**In scope**:
- `apps/web/components/review/share-dialog.tsx` (edit — `SharePanel` only)
- `apps/web/components/review/__tests__/share-dialog.test.tsx` (edit — add a case)

**Out of scope** (do NOT touch):
- `apps/web/components/review/share-direct-panel.tsx` (`DirectTab`) — render it
  unchanged behind the toggle; do not restructure it.
- `apps/web/components/review/share-link-section.tsx` /
  `share-link-controls.tsx` — the link + allow-download stays as the default view.
- `apps/web/components/review/share-bulk-panel.tsx` — already minimal.
- Any backend or share API call.

## Git workflow

- Branch: `advisor/023-simplify-share-popup`
- Conventional commits (e.g. `feat(web): collapse people-invite in share popup`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a collapsed-by-default "Invite specific people" disclosure

Edit `SharePanel` in `apps/web/components/review/share-dialog.tsx`. Add a
`showPeople` state and gate the `DirectTab` block behind it; when collapsed, show
a single button.

Target shape:

```tsx
import * as React from "react";
import { Share2, Users, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
// …existing imports…

export function SharePanel({ target, projectId, withPeople = false }: SharePanelProps) {
  const [showPeople, setShowPeople] = React.useState(false);
  const peopleTarget: PeopleShareTarget | null =
    target.kind === "project" ? null : target;

  return (
    <div className="space-y-4">
      <SingleLinkSection target={target} />
      {withPeople && peopleTarget && (
        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowPeople((v) => !v)}
            className="flex w-full items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            Invite specific people
            <ChevronDown
              className={cn(
                "ml-auto h-3.5 w-3.5 transition-transform",
                showPeople && "rotate-180",
              )}
            />
          </button>
          {showPeople && (
            <div className="mt-3">
              <DirectTab target={peopleTarget} orgId={projectId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Notes:
- `Share2` may already be imported in this file (used by `ShareDialog`); keep it.
  Add `Users` and `ChevronDown`. Add the `cn` import if not present.
- Default `showPeople` is `false` so the popup opens compact.

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "Invite specific people" apps/web/components/review/share-dialog.tsx` → 1 match.

### Step 2: Update the test

In `apps/web/components/review/__tests__/share-dialog.test.tsx`, add/adjust a
test (matching the file's existing render style and fixtures) asserting:
- With `withPeople`, the people-invite controls (e.g. the `user@example.com`
  email input, queryable via placeholder) are **not** in the document on initial
  render.
- After clicking the "Invite specific people" button (query by text/role), the
  email input **is** in the document.

If an existing test assumed the people block renders immediately, update it to
click the toggle first (do not delete the assertion — move it behind the click).

**Verify**: `cd apps/web && pnpm test share-dialog` → all pass.

### Step 3: Lint + full test

**Verify**:
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → all pass.

## Test plan

- The behavior is deterministic and jsdom-friendly: assert the collapsed default
  and the expand-on-click (step 2). This is the regression gate that the popup
  opens compact and the full flow is still reachable.
- Manual check (note in PR): open the asset Share dropdown and the project/folder
  share dialog — both open showing only link + permission + copy + allow-download;
  clicking "Invite specific people" reveals the user/team form; sharing still works.

Verification: `cd apps/web && pnpm test` → all pass, including the updated case.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0; the share-dialog test asserts the
      collapsed default + expand-on-click
- [ ] `grep -n "Invite specific people" apps/web/components/review/share-dialog.tsx` → 1 match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpt of `SharePanel` doesn't match the live code (drift).
- `DirectTab` is no longer exported from `share-direct-panel.tsx` or its props
  changed from `{ target, orgId }`.
- The existing share-dialog test cannot be made to pass by adding a toggle click
  (i.e. it depends on something this change legitimately breaks) — report it
  rather than deleting assertions.

## Maintenance notes

- This is pure presentation: no share semantics change. A reviewer should confirm
  every previously-reachable control is still reachable (one click away).
- If the team later wants "Allow download" also demoted, move it from
  `LinkControls` into this collapsible — but that's a separate, larger change
  (it would touch `share-link-controls.tsx`, which is shared with `BulkSharePanel`).
  Deferred on purpose.
