# Lumina CLI

Local control plane for Lumina:

- configure remote Lumina profile/token
- install/start local Bridge
- manage pluggable knowledge providers (`llm_wiki` first)
- sync topics and call OpenAPI helpers

## Quick start

```bash
# from repo
cd cli
python3 -m lumina_cli version
python3 -m lumina_cli init --non-interactive
python3 -m lumina_cli doctor

# or install entrypoint
../scripts/install-lumina-cli.sh
lumina up --install
lumina sync
```

Config: `~/.lumina/config.yaml`
Bridge runtime: `~/.lumina/topic-bridge`

## Shell completion

```bash
# zsh
eval "$(lumina completion zsh)"
# or
lumina completion zsh > ~/.lumina/completion.zsh && echo "source ~/.lumina/completion.zsh" >> ~/.zshrc
```

## Providers

- `llm_wiki` — full local compile engine adapter
- `generic_fs` — filesystem skeleton provider (no daemon/compile yet)

```bash
lumina knowledge providers
lumina knowledge use generic_fs
lumina knowledge init
lumina knowledge doctor
```

## Knowledge rebuild

`lumina sync full` re-exports all remote articles into local sources, but keeps existing wiki pages.

True rebuild (destructive):

```bash
# preview
lumina sync full --rebuild --dry-run

# wipe local knowledge data, re-export sources, best-effort recompile, then write back
lumina sync full --rebuild --yes
```

Rebuild semantics:

1. delete local `raw/` + `wiki/` under the knowledge project
2. reset Bridge article hash/path cursors
3. export **all** remote articles (no `updated_after`)
4. rewrite `raw/sources/lumina/*`
5. best-effort ask llm_wiki to recompile (current llm_wiki HTTP surface may only expose `/health`)
6. scan wiki topics and write back to Lumina

If llm_wiki has not finished compiling yet, rebuild/full export returns `status=awaiting_compile` and Bridge schedules an **automatic secondary writeback** once entity/concept pages appear under `wiki/`. You usually do not need to manually sync again for Web to update.

Rebuild also wipes llm_wiki runtime residues under `.llm-wiki/` (`review.json`, `history/`, `lancedb/`, ingest cache/queues), not only `raw/` + `wiki/`.

macOS note: if the knowledge project lives under Desktop/Documents/Downloads, LaunchAgent-run Bridge may hit `Operation not permitted`. Prefer a path like `~/.lumina/knowledge`, grant Full Disk Access to the Bridge Python, or run `lumina bridge start --no-service` from Terminal for file access.

## First-time setup

All prompts have defaults. Just press Enter to accept.

Interactive flow:

1. Lumina base URL / token (always asked)
2. Install local knowledge runtime? (default Yes)
3. If yes: Bridge host/port/token, provider, project path/name
4. PATH is added automatically (`~/.lumina/bin`) so new terminals can run `lumina`

```bash
./scripts/install-lumina-cli.sh

# scripted
./scripts/install-lumina-cli.sh --yes   --base-url http://127.0.0.1:8000/backend   --token dev-internal-token-change-me   --project-path "$HOME/.lumina/knowledge/Lumina-Knowledge"   --install-bridge
```

What “add to PATH” means:

- CLI binary lives at `~/.lumina/bin/lumina`
- without PATH, you must call the full path every time
- PATH is written by default; new terminal tabs can run `lumina ...` directly. Use `--no-add-path` to skip.

Reconfigure later:

```bash
lumina init --guided --force
```



## Bridge runtime (default: OS service)

`start/stop/restart/status` are the only commands you need.

```bash
lumina bridge start      # default: install/use LaunchAgent or systemd --user
lumina bridge status     # includes mode=service|nohup + service details
lumina bridge restart
lumina bridge stop       # stop now (unit remains for next start)
lumina bridge stop --disable-service   # stop and remove supervised unit
```

Escape hatch:

```bash
lumina bridge start --no-service   # bare nohup only
lumina bridge stop --no-service
lumina bridge restart --no-service
```

Backends:

- macOS: LaunchAgent `com.lumina.bridge` (`KeepAlive`, login start)
- Linux: systemd user unit `lumina-bridge.service` (`Restart=always`)

Notes:

- Default path is supervised service; nohup only when `--no-service` is explicit (or platform unsupported).
- Linux boot-without-login may need: `loginctl enable-linger $USER`
- Knowledge provider (e.g. LLM Wiki app) is still separate; this only supervises Bridge.
