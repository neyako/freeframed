# Plan 064: Real byte-level upload progress (XHR instead of fetch)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. A reviewer
> maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**:
> `git diff --stat a7d1e10..HEAD -- apps/web/stores/upload-store.ts`
> If it changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches the live upload path; behavior-preserving except progress granularity)
- **Depends on**: none
- **Category**: bug / UX
- **Planned at**: commit `a7d1e10`, 2026-07-04

## Why this matters

The upload progress bar jumps from 0% to 100% instead of animating. Root cause:
each multipart part is PUT with `fetch()`, which cannot report upload progress.
`progress` is only updated **after** a whole part finishes, at
`Math.round((partNumber / totalChunks) * 95)`. With `CHUNK_SIZE = 10 MB`, any
file ≤10 MB is a single part, so progress goes 0 → 95 → 100 in two steps. Larger
files step per 10 MB part but never animate within a part.

The fix: upload each part with `XMLHttpRequest` and its `upload.onprogress`
event, so `progress` reflects bytes actually sent. There are **two** upload
loops in the store (initial upload and add-as-new-version); route both through
one shared helper.

## Current state

`apps/web/stores/upload-store.ts`:

- `CHUNK_SIZE` (line 6): `const CHUNK_SIZE = 10 * 1024 * 1024 // 10 MB`
- First upload loop (lines ~185–214) — per part:
```ts
const putResponse = await fetch(presigned_url, {
  method: 'PUT',
  body: chunk,
  signal: controller.signal,
})
if (!putResponse.ok) {
  throw new Error(`Part ${partNumber} failed: ${putResponse.statusText}`)
}
const etag = putResponse.headers.get('ETag') ?? ''
parts.push({ PartNumber: partNumber, ETag: etag })
updateFile(id, { progress: Math.round((partNumber / totalChunks) * 95) })
```
- Second loop (add-as-new-version, lines ~298–313) — same shape:
```ts
const putResponse = await fetch(presigned_url, { method: 'PUT', body: chunk, signal: controller.signal })
...
updateFile(id, { progress: Math.round((partNumber / totalChunks) * 95) })
```

Both loops: get a presigned URL, PUT the chunk, read the `ETag` response header,
push `{ PartNumber, ETag }`, then bump `progress`. On completion both set
`progress: 100`. Cancellation uses an `AbortController` (`controller.signal`).

### Repo conventions

- The store is a Zustand store; helpers can be module-scoped functions above the
  `create(...)` call. Match the existing TypeScript style (no `any`, explicit
  return types on exported helpers).
- Errors thrown inside the loop are caught by the surrounding `try/catch` which
  maps `AbortError` → `cancelled` and everything else → `failed`.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**:
- `apps/web/stores/upload-store.ts` (add a helper, use it in both loops)
- `apps/web/stores/__tests__/` — add a small unit test for the helper's progress
  math IF a store test dir exists; otherwise add `apps/web/stores/__tests__/upload-progress.test.ts`.

**Out of scope** (do NOT touch):
- Presign / complete / abort API calls and their shapes — unchanged.
- `processingProgress` (post-upload transcode progress via SSE) — a separate
  concern; leave it alone.
- The upload UI components (`uploads-panel.tsx`, progress bar rendering).

## Git workflow

- Branch: `advisor/064-upload-progress-xhr`
- Commit: `fix(web): byte-level multipart upload progress via XHR (plan 064)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Add an XHR part-upload helper

Near the top of `upload-store.ts` (after `CHUNK_SIZE`), add a module-scoped
helper that PUTs a chunk with progress and returns the ETag. It must support
abort via the existing `AbortController` signal:

```ts
interface PutPartResult {
  etag: string
}

/**
 * PUT a single multipart chunk with byte-level progress.
 * `onProgress` receives the fraction (0..1) of THIS part uploaded so far.
 */
function putPartWithProgress(
  url: string,
  chunk: Blob,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<PutPartResult> {
  return new Promise<PutPartResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    const onAbort = () => xhr.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') ?? '' })
      } else {
        reject(new Error(`Part failed: ${xhr.status} ${xhr.statusText}`))
      }
    }
    xhr.onerror = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error('Part failed: network error'))
    }
    xhr.onabort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Upload cancelled', 'AbortError'))
    }
    xhr.send(chunk)
  })
}
```

**Verify**: `grep -c "putPartWithProgress" apps/web/stores/upload-store.ts` → `3`
(definition + two call sites, after Step 2).

### Step 2: Use the helper in both upload loops

In **both** loops, replace the `fetch(...)` PUT + `!putResponse.ok` check +
`etag` read + the trailing `updateFile(id, { progress: ... })` with a call to
the helper whose `onProgress` maps this part's fraction into the overall 0–95
range:

```ts
const { etag } = await putPartWithProgress(
  presigned_url,
  chunk,
  controller.signal,
  (fraction) => {
    const overall = ((partNumber - 1 + fraction) / totalChunks) * 95
    updateFile(id, { progress: Math.round(overall) })
  },
)
parts.push({ PartNumber: partNumber, ETag: etag })
```

Notes:
- Keep the `controller.signal.aborted` guard at the top of each loop iteration.
- Keep everything else (presign call, `parts` array, `/upload/complete`, the
  `progress: 100` on completion) unchanged.
- In the first loop the chunk variable is built from `file.slice(start, end)`;
  in the second it's `file.slice(start, Math.min(start + CHUNK_SIZE, file.size))`.
  Pass whichever chunk variable each loop already has.

**Verify**: `grep -c "fetch(presigned_url" apps/web/stores/upload-store.ts` → `0`
(both fetch PUTs are gone); `grep -c "putPartWithProgress" apps/web/stores/upload-store.ts` → `3`

### Step 3: Unit-test the progress math

Add `apps/web/stores/__tests__/upload-progress.test.ts` that verifies the
overall-progress formula produces a monotonic non-decreasing sequence and never
exceeds 95 mid-upload. Follow the style of an existing vitest test in the repo
(e.g. `apps/web/components/__tests__/*.test.tsx` for imports/assert style). Test
the pure formula (extract it or replicate it):

```ts
import { describe, it, expect } from 'vitest'

// overall progress for part `p` (1-based) of `n`, `fraction` (0..1) into it
const overall = (p: number, n: number, fraction: number) =>
  Math.round(((p - 1 + fraction) / n) * 95)

describe('multipart upload progress', () => {
  it('is 0 at the very start', () => {
    expect(overall(1, 5, 0)).toBe(0)
  })
  it('reaches 95 (not 100) when the last part completes', () => {
    expect(overall(5, 5, 1)).toBe(95)
  })
  it('is monotonic across a single-part upload', () => {
    const seq = [0, 0.25, 0.5, 0.75, 1].map((f) => overall(1, 1, f))
    expect(seq).toEqual([0, 24, 48, 71, 95])
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1])
  })
})
```

**Verify**: `pnpm test -- upload-progress` → all pass.

### Step 4: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "fetch(presigned_url" apps/web/stores/upload-store.ts` → `0`
- [ ] `grep -c "putPartWithProgress" apps/web/stores/upload-store.ts` → `3`
- [ ] New test `upload-progress.test.ts` exists and passes
- [ ] Only in-scope files modified (`git status`)

## STOP conditions

- The upload-loop excerpts don't match the live file (drift).
- There are more than two `fetch(presigned_url` call sites (a third upload path
  appeared) — report; convert all of them the same way only if trivially
  identical, else STOP.
- Cancellation tests (if any exist for uploads) fail — the XHR abort wiring must
  preserve the `AbortError` → `cancelled` behavior; if you can't, STOP.

## Maintenance notes

- The 95%-cap-until-complete convention is intentional: the final 95→100 marks
  server-side `/upload/complete`. Keep it.
- If HTTP/2 or S3 multipart parallelism is added later, the per-part
  `onProgress` fractions must be summed across in-flight parts, not assumed
  sequential.
