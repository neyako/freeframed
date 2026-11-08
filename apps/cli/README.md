# ffd: freeframed for AI agents

`ffd.py` lets an agent (Claude Code, Codex, anything with a shell) upload a cut,
read your feedback, and wait until you approve. It's one Python file that needs
only the standard library.

## Setup

In freeframed, open Settings > Agents and press Connect on Claude, ChatGPT,
Muse or Gemini. Paste the setup prompt it shows (the token is shown once) into
that agent. The prompt has the agent:

1. download `ffd` from your freeframed (`GET /api/cli/ffd`) into `~/.local/bin`,
2. run `ffd login --url <freeframed> --token ffd_...`,
3. run `ffd guide` (the `freeframed-review` skill, served at `/api/cli/guide`)
   and save it as a skill.

Each preset is one agent account with its upstream logo
(`apps/web/public/agents/`). New token replaces the old one; Remove revokes it,
and its uploads and comments stay.

## How the loop works

```
agent: ffd upload cut.mp4 --asset <id> --note "v3: ..."   -> new version
agent: ffd wait <id>                    (background; blocks)
you:   comment, draw, mark cuts, then Request changes or Approve
agent: reads the brief + drawing snapshots, revises,
       ffd reply <id> <comment> "Done in v4: ..." --resolve, uploads v4, waits again
```

Your approve or request-changes on the newest version is the only thing that
wakes the agent, so it never acts on a half-finished review. Agent accounts can
comment and upload, but they can't approve.

| Command | What it does |
| --- | --- |
| `ffd guide` | print the review-loop guide (save it as a skill) |
| `ffd projects` | list project ids |
| `ffd upload FILE --project ID \| --asset ID [--note TEXT]` | new asset, or next version |
| `ffd wait ASSET [--timeout S]` | block until a decision, then print the brief (exit 3 = timed out) |
| `ffd feedback ASSET [--version N] [--json]` | print the brief now |
| `ffd status ASSET` | newest version, processing state, decision |
| `ffd reply ASSET COMMENT TEXT [--resolve]` | answer a comment |
| `ffd resolve COMMENT [--reopen]` | set resolved |
| `ffd comment ASSET TEXT [--at S --to S]` | ask a question at a time |

Drawing snapshots and image attachments are saved to
`./freeframed-feedback/<asset>-v<N>/` (or `--out`), and their paths appear in
the brief.
