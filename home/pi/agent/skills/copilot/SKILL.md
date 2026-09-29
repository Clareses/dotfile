---
name: copilot
description: >-
  Show code to the user in a side tmux+nvim "copilot" pane. Opens files, jumps to lines or
  patterns, builds multi-file layouts, runs commands in a shell pane, and closes panes.
  Trigger: /copilot, "打开代码", "跳到", "开个窗给我看", "show me the code", "copilot".
disable-model-invocation: true
---

# Copilot (tmux + nvim side pane)

Drive a dedicated nvim pane so the user can read code while the pi pane stays on
the conversation. Layout convention: **pi on the left, copilot nvim on the right,
`run` shells below.**

> Only load this skill when the user explicitly invokes `/copilot` (this file has
> `disable-model-invocation: true`). Do not auto-trigger it.

## Iron rule: two kinds of actions, two behaviors

**Navigation (`open`, `jump`, `close`) — fire-and-forget.** Execute and STOP.
- **Never** run `tmux capture-pane` / read back to "check" that the pane
  opened or the cursor jumped.
- No multi-step verification loops, no second guess, no "let me confirm".
- Reply with at most one short line (e.g. `已打开 scheduler.py:248`), then end.

**Execution (`run`) and editing (`keys`) — must be checked and reported.**
- After `run`, read the output with `copilot.sh out` and relay the actual
  result, errors, and exit status to the user. Do not assume success.
- After `keys` edits something, read the nvim state with `copilot.sh peek` and
  confirm the edit actually landed. Do not assume it worked.
- Long-running commands may need `out` called again.

The script is quiet by design for navigation; trust it there. For `run` and
`keys` you are explicitly expected to read back.

## Tool

```bash
bash ~/.pi/agent/skills/copilot/scripts/copilot.sh <command> [args...]
```

Resolves the pi pane from `$TMUX_PANE` automatically. Reuses one nvim pane per
tmux window (state under `~/.cache/copilot/`).

### Reuse an already-open pane

If an nvim pane is already open on the right — you opened it by hand, or it
survived from an earlier run — **use it; do not split a new one.** `open`/`jump`
auto-detect any `nvim` pane in the current tmux window (other than the pi pane)
and adopt it. If that nvim was not started with `--listen`, the script still
drives it by typing `:ex` commands through `tmux send-keys`, so
`open`/`jump`/`keys` work either way. Set `COPILOT_NEW_PANE=1` to force a fresh
split.

### Commands

| Command | Usage | Description |
|---|---|---|
| open | `open FILE[:LINE] [FILE2 ...]` | open file(s) to the right; `:LINE` or `::/PATTERN/` jumps |
| jump | `jump FILE[:LINE\|:/PATTERN/]` | jump to a location in the existing pane |
| run | `run CMD...` | run a command in a bottom shell pane (reused) |
| out | `out [LINES]` | print run pane output (default 40 lines) — read-back for `run` |
| peek | `peek [LINES]` | print nvim pane output (default 40 lines) — read-back for `keys` edits |
| close | `close` | close the copilot nvim + run panes |
| keys | `keys KEYS...` | raw `send-keys` to the nvim pane (dangerous, explicit ask only) |

Spec syntax: `path/to/file.py:248`, `path/to/file.py::/layered_prefill_schedule/`,
or just `path/to/file.py`.

### Examples

```bash
# open and land on a line
copilot.sh open nanovllm/engine/scheduler.py:248

# open and land on a symbol/pattern
copilot.sh open nanovllm/engine/scheduler.py::/layered_prefill_schedule/

# multi-file side-by-side layout
copilot.sh open scheduler.py model_runner.py qwen3_moe.py

# run a command in the bottom pane, then read its result back
copilot.sh run "pytest -q"
copilot.sh out 60

# clean up
copilot.sh close
```

## Workflow

1. Map the user's request to one of: `open` (show), `jump` (move cursor),
   `run` (command), `out` (read command output), `keys` (edit, explicit ask),
   `peek` (read nvim state), `close` (cleanup).
2. `open`/`jump`/`close`: run once, reply one line, stop — no read-back.
3. `run`: run the command, then `out` to read and report the result. Never
   claim a command succeeded without checking its output.
4. `keys`: make the edit, then `peek` to confirm it landed before reporting.

## Env overrides

| Var | Default | Meaning |
|---|---|---|
| `COPILOT_PANE` | `$TMUX_PANE` | pane to split from |
| `COPILOT_DIR` | `$PWD` | working dir for new panes |
