# FreeFrame Resolve Review Push

This folder contains DaVinci Resolve utility scripts for sending the current
timeline to FreeFrame review.

## Configure

Create a local config file:

```sh
mkdir -p ~/.freeframe
cp tools/resolve/config.example.json ~/.freeframe/config.json
chmod 600 ~/.freeframe/config.json
```

Edit `~/.freeframe/config.json`:

- `api_url`: FreeFrame API origin, for example `http://localhost:8000`.
- `api_key`: the FreeFrame server's `INTEGRATION_API_KEY`.
- `project_id`: the FreeFrame project UUID that should hold review assets.

The config contains a secret. Keep it local and keep permissions restricted with
`chmod 600 ~/.freeframe/config.json`.

## Install In Resolve On macOS

Symlink the scripts into Resolve's Utility scripts folder so they appear under
**Workspace > Scripts > Utility** and stay synced with this repo:

```sh
SCRIPTS="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility"
mkdir -p "$SCRIPTS"
ln -sf "$PWD/tools/resolve/freeframe_review.py" "$SCRIPTS/"
ln -sf "$PWD/tools/resolve/freeframe_push_for_review.py" "$SCRIPTS/"
ln -sf "$PWD/tools/resolve/freeframe_sync_comments.py" "$SCRIPTS/"
```

## Use

Open the cut in DaVinci Resolve, then run
**Workspace > Scripts > Utility > freeframe_push_for_review**.

The script renders the whole current timeline as an H.264 `.mp4`, uploads it to
FreeFrame, prints the review link in Resolve's Scripts console, and stores the
returned token in `~/.freeframe/resolve_links.json`.

Because this is a whole-timeline render, video time `0` maps to timeline frame
`0`. Plan 007's companion sync-comments script uses that saved token and timing
mapping to pull reviewer comments back into Resolve as markers.

## Sync Comments

Open the same timeline that was pushed for review, then run
**Workspace > Scripts > Utility > freeframe_sync_comments**.

The script reads the saved review token, fetches reviewer comments from
FreeFrame, and places a timeline marker at each timecoded comment. Green markers
are resolved comments; Yellow markers are open comments. Re-run the script to
refresh the FreeFrame markers.

General comments without a timecode are skipped; only frame-anchored comments
become Resolve markers.
