# Plan 046: Batch comment-tree loading — kill the recursive N+1 in comments.py

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 39bdfc6..HEAD -- apps/api/routers/comments.py apps/api/schemas/comment.py`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (hot path; response shape must stay byte-identical)
- **Depends on**: plans/045-real-db-integration-tests.md (soft — the parity
  test in Step 4 uses its fixtures; without 045 landed, Step 4 shrinks to
  the pure-function unit tests and the risk rating rises)
- **Category**: perf
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

`_build_comment_response` in `apps/api/routers/comments.py` issues **five
queries per comment** (annotation, replies, attachments, reactions, author)
and recurses into every reply to depth 5, each reply issuing its own five.
An asset with 40 top-level comments and 60 replies costs ~500 queries per
listing — and the listing runs on every asset open (editor and guest share
viewer) and after every comment post. Comment listing is the hottest read
path in a review tool. A batched loader does the same work in ~7 queries
total, independent of comment count. Attachment URL presigning (one boto3
call per attachment) stays as-is — it's CPU-local, not a DB round-trip.

## Current state

- `apps/api/routers/comments.py` — all comment routes. Key excerpts:

  The per-comment builder (`comments.py:89-138`), abbreviated:

  ```python
  def _build_comment_response(comment, db, current_user_id=None, depth=5):
      annotation = db.query(Annotation).filter(Annotation.comment_id == comment.id).first()
      replies_raw = []
      if depth > 0:
          replies_raw = db.query(Comment).filter(
              Comment.parent_id == comment.id,
              Comment.deleted_at.is_(None),
          ).order_by(Comment.created_at).all()
      attachments_raw = db.query(CommentAttachment).filter(...).all()
      reactions_raw = db.query(CommentReaction).filter(...).all()
      if comment.author_id:
          author = db.query(User).filter(User.id == comment.author_id).first()
      if comment.guest_author_id:
          guest = db.query(GuestUser).filter(GuestUser.id == comment.guest_author_id).first()
      ...
      resp.replies = [_build_comment_response(r, db, ..., depth=depth-1) for r in replies_raw]
  ```

  An unused batch helper already exists (`comments.py:141-146`) — evidence
  someone started this and stopped:

  ```python
  def _get_annotations_map(comment_ids: list[uuid.UUID], db: Session) -> dict:
      """Batch-load annotations for a list of comment IDs."""
      if not comment_ids:
          return {}
      annotations = db.query(Annotation).filter(Annotation.comment_id.in_(comment_ids)).all()
      return {a.comment_id: a for a in annotations}
  ```

  Call sites of `_build_comment_response` (verify with
  `grep -n "_build_comment_response" apps/api/routers/comments.py`):
  - `list_comments` (line ~220): list comprehension over top-level comments
  - `create_comment` (~272), `reply_to_comment` (~312), `update_comment`
    (~340), `resolve_comment` (~381): single comment each
  - `list_share_comments` (~579): list comprehension (guest path, no
    `current_user_id`)

- `apps/api/schemas/comment.py` — `CommentResponse` (Pydantic v2,
  `model_validate`), with `author`, `guest_author`, `annotation`, `replies`,
  `attachments`, `reactions` fields assigned post-validation. The response
  shape is the contract: the web app renders it and
  `tools/resolve/freeframe_sync_comments` consumes the share variant.

- Reaction aggregation is already pure (`_build_reaction_responses`,
  comments.py:73-86) — reuse it unchanged.

- Existing tests: `apps/api/tests/test_share_comments.py` exercises the
  share comment routes with the mocked DB (MagicMock sessions — they will
  keep passing regardless; they are NOT sufficient verification, which is
  why Step 4 exists).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax | `python3 -m py_compile apps/api/routers/comments.py` | exit 0 |
| Mock suite | `python -m pytest apps/api/tests/ -v` | all pass (needs deps installed; otherwise CI) |
| Integration (if 045 landed) | `TEST_DATABASE_URL=... python -m pytest apps/api/tests/integration/ -v` | all pass incl. new parity test |
| Query-count gate (in the new parity test) | see Step 4 | listing 20 comments ≤ 10 queries |

## Scope

**In scope** (the only files you should modify/create):
- `apps/api/routers/comments.py`
- `apps/api/tests/test_comment_batching.py` (create — pure unit tests)
- `apps/api/tests/integration/test_comments_batching_db.py` (create — only
  if 045's `apps/api/tests/integration/` exists)

**Out of scope** (do NOT touch):
- `apps/api/schemas/comment.py` — the response contract; if the batching
  seems to require a schema change, the batching is wrong.
- `apps/api/routers/share.py` — its folder-listing N+1 is a separate,
  deferred finding (see Maintenance notes); don't fix it opportunistically.
- The `_create_mentions` email/notification logic in comments.py — unrelated
  write path.
- `apps/web/**` — no client change; the response is identical.

## Git workflow

- Branch: `advisor/046-comment-batching`
- Commit style: `perf(api): batch comment-tree loading (5 queries/comment → 7 total)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a batch fetch + pure assembly pair

In `apps/api/routers/comments.py`, add two functions (near
`_get_annotations_map`):

```python
def _fetch_comment_tree_data(db, top_level: list[Comment], depth: int = 5) -> dict:
    """Batch-load everything needed to render a comment tree.

    Returns dict with: comments_by_parent, annotations, attachments,
    reactions, users, guests — all keyed maps. Total queries: 1 (per depth
    level for replies, max `depth`) + 5, regardless of comment count.
    """
    all_comments: list[Comment] = list(top_level)
    frontier = [c.id for c in top_level]
    comments_by_parent: dict = {}
    for _ in range(depth):
        if not frontier:
            break
        replies = db.query(Comment).filter(
            Comment.parent_id.in_(frontier),
            Comment.deleted_at.is_(None),
        ).order_by(Comment.created_at).all()
        if not replies:
            break
        for r in replies:
            comments_by_parent.setdefault(r.parent_id, []).append(r)
        all_comments.extend(replies)
        frontier = [r.id for r in replies]

    ids = [c.id for c in all_comments]
    annotations = _get_annotations_map(ids, db)
    attachments: dict = {}
    if ids:
        for a in db.query(CommentAttachment).filter(CommentAttachment.comment_id.in_(ids)).all():
            attachments.setdefault(a.comment_id, []).append(a)
    reactions: dict = {}
    if ids:
        for r in db.query(CommentReaction).filter(CommentReaction.comment_id.in_(ids)).all():
            reactions.setdefault(r.comment_id, []).append(r)

    author_ids = {c.author_id for c in all_comments if c.author_id}
    users = {}
    if author_ids:
        users = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()}
    guest_ids = {c.guest_author_id for c in all_comments if c.guest_author_id}
    guests = {}
    if guest_ids:
        guests = {g.id: g for g in db.query(GuestUser).filter(GuestUser.id.in_(guest_ids)).all()}

    return {
        "comments_by_parent": comments_by_parent,
        "annotations": annotations,
        "attachments": attachments,
        "reactions": reactions,
        "users": users,
        "guests": guests,
    }


def _assemble_comment_response(comment: Comment, data: dict, current_user_id=None) -> CommentResponse:
    """Pure assembly from pre-fetched maps — no DB access. Mirrors the field
    population order of the old _build_comment_response exactly."""
    author_info = None
    author = data["users"].get(comment.author_id) if comment.author_id else None
    if author:
        author_info = AuthorInfo(id=author.id, name=author.name, avatar_url=author.avatar_url)
    guest_author_info = None
    guest = data["guests"].get(comment.guest_author_id) if comment.guest_author_id else None
    if guest:
        guest_author_info = GuestAuthorInfo(id=guest.id, name=guest.name, email=guest.email)

    annotation = data["annotations"].get(comment.id)
    resp = CommentResponse.model_validate(comment)
    resp.author = author_info
    resp.guest_author = guest_author_info
    resp.annotation = AnnotationResponse.model_validate(annotation) if annotation else None
    resp.replies = [
        _assemble_comment_response(r, data, current_user_id=current_user_id)
        for r in data["comments_by_parent"].get(comment.id, [])
    ]
    resp.attachments = [_build_attachment_response(a) for a in data["attachments"].get(comment.id, [])]
    resp.reactions = _build_reaction_responses(data["reactions"].get(comment.id, []), current_user_id)
    return resp
```

Fidelity requirements (each is a behavior of the old code you must preserve):
- Replies ordered by `created_at` (the `ORDER BY` in the frontier query +
  `setdefault` append preserves it within each parent).
- Depth cap 5 (the frontier loop runs `depth` times).
- Soft-deleted replies excluded.
- Empty attachments/reactions → empty lists, not None.
- `current_user_id=None` (guest path) → every reaction's `reacted` is False
  (that's `_build_reaction_responses`'s existing behavior).

**Verify**: `python3 -m py_compile apps/api/routers/comments.py` → exit 0.

### Step 2: Rewire _build_comment_response as a thin wrapper

Replace the body of `_build_comment_response(comment, db, current_user_id=None, depth=5)`
with:

```python
    data = _fetch_comment_tree_data(db, [comment], depth=depth)
    return _assemble_comment_response(comment, data, current_user_id=current_user_id)
```

This keeps every single-comment call site (`create_comment`,
`reply_to_comment`, `update_comment`, `resolve_comment`) source-identical
while making them batched too.

**Verify**: `grep -n "db.query(Annotation).filter(Annotation.comment_id ==" apps/api/routers/comments.py` → no matches
(the old per-comment annotation query is gone).

### Step 3: Batch the two list endpoints

In `list_comments` (~line 220), replace:

```python
    return [_build_comment_response(c, db, current_user_id=current_user.id) for c in top_level]
```

with:

```python
    data = _fetch_comment_tree_data(db, top_level)
    return [_assemble_comment_response(c, data, current_user_id=current_user.id) for c in top_level]
```

Same change in `list_share_comments` (~line 579), keeping its
no-`current_user_id` form:

```python
    data = _fetch_comment_tree_data(db, top_level)
    return [_assemble_comment_response(c, data) for c in top_level]
```

**Verify**: `grep -c "_fetch_comment_tree_data" apps/api/routers/comments.py` → `3`
(definition + 2 list endpoints; the wrapper in Step 2 makes it 4 total —
adjust expectation to `4`: 1 def + wrapper + 2 list endpoints. Use
`grep -n` and confirm the four sites explicitly.)

### Step 4: Tests

**Unit (always)** — create `apps/api/tests/test_comment_batching.py`. Test
`_assemble_comment_response` as a pure function: build plain
`types.SimpleNamespace`/model instances for a comment with 2 replies (one
nested), 1 annotation, 2 reactions from different users, and assert on the
resulting `CommentResponse`: reply order, `reacted` flag for the matching
`current_user_id`, empty-list attachments, guest author populated when
`guest_author_id` set. Note: `CommentResponse.model_validate(comment)`
requires the input to satisfy the schema's `from_attributes` — construct
real `Comment` model instances (they work detached from any session) rather
than raw SimpleNamespace for the comment itself. Model after the assertion
style of `apps/api/tests/test_share_comments.py`.

**Integration (if `apps/api/tests/integration/` exists from plan 045)** —
create `apps/api/tests/integration/test_comments_batching_db.py`:
1. Parity: seed 3 top-level comments, one with 2 replies (one reply
   soft-deleted), annotations on two, reactions and an attachment row on
   one; call the OLD path semantics via the new wrapper on each comment
   individually AND the batched list path; assert
   `[r.model_dump() for r in batched] == [r.model_dump() for r in individual]`.
2. Query count: using SQLAlchemy's `event.listens_for(engine, "before_cursor_execute")`
   counter fixture, assert listing 20 top-level comments with replies issues
   **≤ 10** SQL statements (was ~100+).

**Verify**: `python -m pytest apps/api/tests/test_comment_batching.py -v` →
all pass (or CI if no local env); with 045:
`TEST_DATABASE_URL=... python -m pytest apps/api/tests/integration/test_comments_batching_db.py -v` → all pass.

### Step 5: Full suite

**Verify**: `python -m pytest apps/api/tests/ -v` → everything passes, count
≥ previous (the existing `test_share_comments.py` mock tests must be
untouched and green).

## Test plan

Covered in Step 4: pure-assembly unit tests (order, reactions,
guest/author, empties), and — with 045 — a byte-parity test old-vs-new plus
a hard query-count ceiling. The parity test is the load-bearing one;
prioritize it if time-boxed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "db.query(Annotation).filter(Annotation.comment_id ==" apps/api/routers/comments.py` → no matches
- [ ] `_fetch_comment_tree_data` + `_assemble_comment_response` exist; wrapper + both list endpoints use them (4 call/def sites confirmed by grep)
- [ ] `python3 -m py_compile apps/api/routers/comments.py` → exit 0
- [ ] Unit tests in `test_comment_batching.py` pass
- [ ] (with 045) parity + query-count integration tests pass
- [ ] Full API suite green (local or CI)
- [ ] `apps/api/schemas/comment.py` unmodified (`git diff --stat` clean for it)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in Current state don't match `comments.py` (drift — someone
  else touched the builder).
- The parity test finds ANY field difference between old and new output —
  do not "fix" the test; report the differing field. (Likely culprits:
  reply ordering across parents, `reacted` flags, None-vs-[] on empties.)
- You find yourself wanting to change `CommentResponse` or any schema —
  out of scope, wrong direction.
- Reply depth behavior differs: the old code queries replies even at
  depth=1 then stops recursing at depth=0; if the frontier translation of
  that boundary produces a different tree depth in the parity test, report
  rather than tweak until green.

## Maintenance notes

- **Deferred sibling**: `routers/share.py:1321-1402` (guest folder listing)
  has the same per-row pattern (per-asset `_get_latest_media_file` + comment
  COUNT + creator lookup, per-subfolder preview loops). Same batching recipe
  applies; it was deliberately left out to keep this plan reviewable. Next
  perf plan candidate.
- Attachment presigning is still one boto3 `generate_presigned_url` call per
  attachment (local CPU, no network) — if attachment counts explode, presign
  lazily on the client instead.
- If pagination is ever added to comment listing, `_fetch_comment_tree_data`
  takes the paginated top-level slice — the design already supports it.
- Reviewer focus: the parity test's fixture must include a soft-deleted
  reply and a guest-authored comment — those are the two regressions this
  refactor could plausibly introduce.
