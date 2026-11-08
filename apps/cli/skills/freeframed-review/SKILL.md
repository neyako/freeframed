---
name: freeframed-review
description: Upload a video cut to freeframed for review, then babysit it until it is approved, revising from the reviewer's timecoded comments, drawings and cuts. Use when the user asks to send a cut or render for review, upload to freeframed, wait for feedback, or babysit or iterate a video until approval.
---

# freeframed review loop

You edit; the user reviews in freeframed (their self-hosted Frame.io). The `ffd`
CLI is your whole interface. Run `ffd <command> -h` for flags.

## Setup check

Run `ffd projects`. If `ffd` is missing or says "Not configured", ask the user
to open freeframed Settings > Agents, press Connect (or New token) on your
agent, and paste you the setup prompt. It installs `ffd` from their freeframed
and logs you in. Never print the token back.

## The loop

1. **Upload.** The first cut creates the asset:
   `ffd upload <render> --project <project id> --note "<what this cut is>"`.
   Every later cut is a new version of that same asset:
   `ffd upload <render> --asset <asset id> --note "<what changed>"`.
   Record the asset id (in your project notes or memory) so later sessions can
   pick the loop back up. The note becomes your first comment on the version, so
   keep it to the changes, mapped to the comments they answer.

2. **Wait.** Run `ffd wait <asset id> --timeout 6900` as a background command
   and end your turn. Don't poll with your own loops. It returns once the user
   approves or requests changes on the newest version. Exit codes: 3 means
   still waiting, so start it again. 2 means the upload failed to process, so
   re-export and upload again.

3. **Read the brief.** `wait` prints markdown: the decision, the reviewer's
   note, then the open comments sorted by time. Each comment has:
   - a time like `0:12.17 (f365)` or a range, measured from the start of *that
     version*. If you have already changed the timeline since, map the time
     through your edits before acting.
   - `CUT`: take those frames out of the edit.
   - `image:` lines: local paths to drawing snapshots (the frame with the
     reviewer's marks on it) and reference images. Open every one with Read
     before you act on that comment. The drawing is often the actual note.
   - replies, and the comment `id=` you use for replies.
   "Your notes" holds your own version notes. Treat replies to them as feedback.

4. **Revise**, render, and upload the next version (step 1). Then answer each
   open comment on the version you just reviewed:
   - done: `ffd reply <asset> <comment id> "Done in v4: <what you did>" --resolve`
   - not done, or you disagree: reply with why, and leave it open.
   - unclear: ask before guessing. Use `ffd reply`, or
     `ffd comment <asset> "<question>" --at <seconds>` for a new question on
     the newest version.
   Then go back to step 2.

5. **Approved.** The loop ends. Do what the user's workflow asks next (for
   example, export the timeline XML for their finishing pass). List any
   comments still open in your report; don't upload another version unless the
   user asks.

## Learning their taste

Feedback that states a lasting preference ("never put a whoosh on every cut",
"captions stay off the face") belongs in your memory or project notes, so the
next cut starts closer to what they want.

## Limits

- You can't approve or reject. Those are the user's hand-off signals.
- `ffd feedback <asset> [--version N]` prints the brief at any time, without
  waiting.
- `ffd status <asset>` gives one line: newest version, processing state,
  decision.
