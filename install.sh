#!/usr/bin/env bash
#
# dotfile installer — 把本仓库里的配置软链接/镜像到它们该在的位置。
#
#   ./install.sh               安装（幂等；已存在的真实文件先备份再替换）
#   ./install.sh --dry-run     只打印将要做什么，不改动任何东西
#   ./install.sh --status      查看每条当前状态
#   ./install.sh --uninstall   移除本仓库建立的软链接（备份保留在 BACKUP_ROOT）
#
# 环境变量:
#   DOTFILE_BACKUP_ROOT  备份根目录（默认 ~/.local/state/dotfile/backups）
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$REPO/links.manifest"
HOME_DIR="${HOME:?HOME is not set}"
BACKUP_ROOT="${DOTFILE_BACKUP_ROOT:-$HOME/.local/state/dotfile/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

DRY=0
ACTION="install"

usage() { sed -n '2,15p' "$0"; }

for arg in "$@"; do
  case "$arg" in
    -n|--dry-run) DRY=1 ;;
    --status)     ACTION="status" ;;
    --uninstall)  ACTION="uninstall" ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

expand() {
  case "$1" in
    "~")   echo "$HOME_DIR" ;;
    "~/"*) echo "$HOME_DIR/${1#\~/}" ;;
    *)     echo "$1" ;;
  esac
}

log() { printf '%s\n' "$*"; }

run() {
  if [ "$DRY" = 1 ]; then
    log "    DRY: $*"
  else
    "$@"
  fi
}

# 若目标已存在（真实文件/目录或别的软链接），移到本次备份目录
backup_target() {
  local t="$1"
  if [ ! -e "$t" ] && [ ! -L "$t" ]; then return 0; fi
  local dest="$BACKUP_DIR/${t#/}"
  log "    backup: $t -> $dest"
  run mkdir -p "$(dirname "$dest")"
  run mv "$t" "$dest"
}

is_our_link() {
  local t="$1" src="$2"
  [ -L "$t" ] || return 1
  local cur src_abs
  src_abs="$(readlink -f "$src" 2>/dev/null || true)"
  cur="$(readlink -f "$t" 2>/dev/null || true)"
  [ -n "$src_abs" ] && [ "$cur" = "$src_abs" ]
}

link_one() { # $1 repo abs src, $2 abs target
  local src="$1" tgt="$2"
  if is_our_link "$tgt" "$src"; then
    [ "$ACTION" = status ] && log "  ok    $tgt"
    return 0
  fi
  case "$ACTION" in
    status)
      [ -e "$tgt" ] || [ -L "$tgt" ] && log "  drift $tgt" || log "  miss  $tgt"
      return 0 ;;
    uninstall)
      if [ -L "$tgt" ]; then
        local cur; cur="$(readlink -f "$tgt" 2>/dev/null || true)"
        case "$cur" in
          "$REPO"/*) log "  unlink $tgt"; run rm -f "$tgt" ;;
          *)         log "  skip (not ours) $tgt" ;;
        esac
      else
        log "  skip (not a link) $tgt"
      fi
      return 0 ;;
  esac
  backup_target "$tgt"
  run mkdir -p "$(dirname "$tgt")"
  local rel
  rel="$(realpath --relative-to="$(dirname "$tgt")" "$src")"
  log "  link  $tgt -> $rel"
  run ln -s "$rel" "$tgt"
}

mirror_one() { # $1 repo abs dir, $2 abs target dir
  local src="$1" tgt="$2"
  if [ ! -d "$src" ]; then log "  skip (repo dir missing): $src"; return 0; fi
  [ "$ACTION" = status ] || run mkdir -p "$tgt"
  local child base
  for child in "$src"/* "$src"/.[!.]* "$src"/..?*; do
    [ -e "$child" ] || [ -L "$child" ] || continue
    base="$(basename "$child")"
    link_one "$child" "$tgt/$base"
  done
}

install_entry() { # $1 mode, $2 abs src, $3 abs tgt
  local mode="$1" src="$2" tgt="$3"
  case "$mode" in
    linkdir)
      if [ ! -d "$src" ]; then log "  skip (repo dir missing): $src"; return 0; fi
      [ "$ACTION" = status ] || run mkdir -p "$(dirname "$tgt")"
      link_one "$src" "$tgt" ;;
    linkfile)
      if [ ! -e "$src" ]; then log "  skip (repo file missing): $src"; return 0; fi
      [ "$ACTION" = status ] || run mkdir -p "$(dirname "$tgt")"
      link_one "$src" "$tgt" ;;
    mirror) mirror_one "$src" "$tgt" ;;
    *) log "  !! 未知 mode: $mode"; return 1 ;;
  esac
}

log "repo:      $REPO"
log "home:      $HOME_DIR"
log "backup:    $BACKUP_DIR"
log "action:    $ACTION$([ "$DRY" = 1 ] && echo ' (dry-run)')"
log ""

[ -f "$MANIFEST" ] || { echo "找不到 manifest: $MANIFEST" >&2; exit 1; }

while IFS=$' \t' read -r mode src tgt _rest; do
  case "$mode" in ""|\#*) continue ;; esac
  [ -n "${src:-}" ] && [ -n "${tgt:-}" ] || continue
  install_entry "$mode" "$REPO/$src" "$(expand "$tgt")"
done < "$MANIFEST"

log ""
if [ "$ACTION" = install ] && [ "$DRY" = 0 ]; then
  log "完成。备份在: $BACKUP_DIR"
  log "回滚: 把上面的文件从备份目录移回原处即可。"
fi
