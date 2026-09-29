#!/usr/bin/env bash
# copilot - drive a side tmux+nvim "copilot" pane to show code to the user.
#
# Navigation (open/jump/close) is fire-and-forget: no read-back.
# Execution (run) and editing (keys) are verified via `out` / `peek`.
#
# Layout convention: the pi pane (left) stays focused; copilot nvim opens to
# its right, and `run` creates a shell pane below.
#
# Commands:
#   open  FILE[:LINE] [FILE2 ...]   open file(s); :LINE or :/PATTERN/ jumps
#   jump  FILE[:LINE|:/PATTERN/]    jump to a location (reuses the pane)
#   run   CMD...                    run a command in a bottom shell pane
#   out   [LINES]                   print the run pane output (default 40) - READ BACK
#   peek  [LINES]                   print the nvim pane output (default 40) - READ BACK
#   close                           close the copilot nvim + run panes
#   keys  KEYS...                   raw send-keys to the nvim pane (verify with peek)
#
# Env:
#   COPILOT_PANE   tmux pane id to split from (default: $TMUX_PANE)
#   COPILOT_DIR    working dir for new panes (default: $PWD)
#   COPILOT_NEW_PANE  set to force a fresh split (skip reusing an open nvim)
set -uo pipefail

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/copilot"
mkdir -p "$STATE_DIR"

die() { printf 'copilot: %s\n' "$*" >&2; exit 1; }

[ -n "${TMUX:-}" ] || die "not inside tmux"
PI_PANE="${COPILOT_PANE:-$TMUX_PANE}"
[ -n "$PI_PANE" ] || die "cannot determine pi pane (set COPILOT_PANE or TMUX_PANE)"
CMD_DIR="${COPILOT_DIR:-$PWD}"
WIN="$(tmux display-message -p -t "$PI_PANE" '#{window_id}')" || die "bad pane $PI_PANE"

NPANE_FILE="$STATE_DIR/$WIN.nvim_pane"
NSOCK="$STATE_DIR/$WIN.nvim.sock"
RPANE_FILE="$STATE_DIR/$WIN.run_pane"

CO_PANE=""
CO_SOCK="$NSOCK"

pane_alive() { tmux list-panes -F '#{pane_id}' 2>/dev/null | grep -qx "$1"; }
pane_is_nvim() { tmux list-panes -F '#{pane_id} #{pane_current_command}' 2>/dev/null | grep -q "^$1 nvim$"; }

# Vimscript single-quoted string literal (double internal quotes).
vimq() { local s=$1; s=${s//\'/\'\'}; printf "'%s'" "$s"; }

# Evaluate a Vimscript expr in the copilot nvim. Prefers the --listen socket;
# falls back to typing an ex command into an adopted (socket-less) nvim pane.
rex() {
  if [ -n "$CO_SOCK" ] && [ -S "$CO_SOCK" ]; then
    nvim --server "$CO_SOCK" --remote-expr "$1" >/dev/null 2>&1
  else
    tmux send-keys -t "$CO_PANE" Escape
    tmux send-keys -t "$CO_PANE" ":$1" Enter
  fi
}

ensure_nvim() {
  if [ -f "$NPANE_FILE" ]; then
    local p; p="$(cat "$NPANE_FILE")"
    if pane_alive "$p" && pane_is_nvim "$p"; then
      CO_PANE="$p"; return 0
    fi
    pane_alive "$p" && tmux kill-pane -t "$p" 2>/dev/null
    rm -f "$NPANE_FILE"
  fi

  # Reuse an nvim pane already open in this window (e.g. one the user opened by
  # hand on the right) instead of splitting yet another pane. It gets driven via
  # tmux send-keys (rex() falls back when there is no --listen socket).
  if [ -z "${COPILOT_NEW_PANE:-}" ]; then
    local ex
    ex="$(tmux list-panes -t "$WIN" -F '#{pane_id} #{pane_current_command}' 2>/dev/null \
          | awk -v self="$PI_PANE" '$1 != self && $2 == "nvim" { print $1; exit }')"
    if [ -n "$ex" ]; then
      CO_PANE="$ex"; CO_SOCK=""
      printf '%s\n' "$CO_PANE" > "$NPANE_FILE"
      return 0
    fi
  fi

  rm -f "$NSOCK"
  CO_SOCK="$NSOCK"
  CO_PANE="$(tmux split-window -h -t "$PI_PANE" -c "$CMD_DIR" -P -F '#{pane_id}')" || die "split-window failed"
  printf '%s\n' "$CO_PANE" > "$NPANE_FILE"
  tmux send-keys -t "$CO_PANE" "nvim --listen '$NSOCK'" Enter
  local i
  for i in $(seq 1 60); do [ -S "$NSOCK" ] && break; sleep 0.05; done
  [ -S "$NSOCK" ] || die "nvim server did not come up at $NSOCK"
}

# parse FILE[:LINE] or FILE::/PATTERN/  -> CO_FILE CO_LINE CO_PAT
CO_FILE=""; CO_LINE=""; CO_PAT=""
parse_spec() {
  CO_FILE="$1"; CO_LINE=""; CO_PAT=""
  if [[ $1 =~ ^(.*):([0-9]+)$ ]]; then
    CO_FILE="${BASH_REMATCH[1]}"; CO_LINE="${BASH_REMATCH[2]}"
  elif [[ $1 =~ ^(.*):/(.*)/$ ]]; then
    CO_FILE="${BASH_REMATCH[1]}"; CO_PAT="${BASH_REMATCH[2]}"
  fi
}

# build the ex expression that opens $CO_FILE and lands the cursor
land_expr() {
  local vf; vf="$(vimq "$CO_FILE")"
  if [ -n "$CO_LINE" ]; then
    printf "execute('edit ' . fnameescape(%s) . ' | call cursor(%s,1) | normal! zz')" "$vf" "$CO_LINE"
  elif [ -n "$CO_PAT" ]; then
    printf "execute('edit ' . fnameescape(%s) . ' | call cursor(1,1) | call search(%s) | normal! zz')" "$vf" "$(vimq "$CO_PAT")"
  else
    printf "execute('edit ' . fnameescape(%s) . ' | normal! gg')" "$vf"
  fi
}

cmd_open() {
  [ $# -ge 1 ] || die "usage: copilot open FILE[:LINE] [FILE2 ...]"
  ensure_nvim
  local first=1 spec
  for spec in "$@"; do
    parse_spec "$spec"
    if [ "$first" = 1 ]; then
      rex "$(land_expr)"; first=0
    else
      local vf; vf="$(vimq "$CO_FILE")"
      rex "execute('vsplit ' . fnameescape($vf))"
      [ -n "$CO_LINE" ] && rex "execute('call cursor($CO_LINE,1) | normal! zz')"
      [ -n "$CO_PAT" ]  && rex "execute('call cursor(1,1) | call search($(vimq "$CO_PAT")) | normal! zz')"
    fi
  done
}

cmd_jump() {
  [ $# -eq 1 ] || die "usage: copilot jump FILE[:LINE|:/PATTERN/]"
  ensure_nvim
  parse_spec "$1"
  rex "$(land_expr)"
}

cmd_run() {
  [ $# -ge 1 ] || die "usage: copilot run CMD..."
  local cmd="$*" p=""
  if [ -f "$RPANE_FILE" ]; then
    p="$(cat "$RPANE_FILE")"; pane_alive "$p" || p=""
  fi
  if [ -z "$p" ]; then
    p="$(tmux split-window -v -t "$PI_PANE" -c "$CMD_DIR" -P -F '#{pane_id}')" || die "split-window failed"
    printf '%s\n' "$p" > "$RPANE_FILE"
  fi
  tmux send-keys -t "$p" "$cmd" Enter
}

cmd_out() {
  local lines="${1:-40}" p
  [ -f "$RPANE_FILE" ] || die "no run pane yet (use 'run' first)"
  p="$(cat "$RPANE_FILE")"
  pane_alive "$p" || die "run pane is gone"
  tmux capture-pane -p -t "$p" | tail -n "$lines"
}

cmd_peek() {
  local lines="${1:-40}" p
  [ -f "$NPANE_FILE" ] || die "no nvim pane yet (use 'open' first)"
  p="$(cat "$NPANE_FILE")"
  pane_alive "$p" || die "nvim pane is gone"
  tmux capture-pane -p -t "$p" | tail -n "$lines"
}

cmd_close() {
  local f p
  for f in "$NPANE_FILE" "$RPANE_FILE"; do
    if [ -f "$f" ]; then
      p="$(cat "$f")"; pane_alive "$p" && tmux kill-pane -t "$p" 2>/dev/null
      rm -f "$f"
    fi
  done
  rm -f "$NSOCK"
}

cmd_keys() {
  [ $# -ge 1 ] || die "usage: copilot keys KEYS..."
  ensure_nvim
  tmux send-keys -t "$CO_PANE" "$@"
}

case "${1:-}" in
  open)  shift; cmd_open  "$@" ;;
  jump)  shift; cmd_jump  "$@" ;;
  run)   shift; cmd_run   "$@" ;;
  out)   shift; cmd_out   "$@" ;;
  peek)  shift; cmd_peek  "$@" ;;
  close) shift; cmd_close "$@" ;;
  keys)  shift; cmd_keys  "$@" ;;
  ""|-h|--help) awk 'NR>1 && /^[^#]/ {exit} NR>1 {print}' "$0" ;;
  *) die "unknown command: $1" ;;
esac
