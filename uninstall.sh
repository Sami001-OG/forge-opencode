#!/usr/bin/env bash
# Remove Forge for OpenCode. Project state in .forge/ is never touched.
set -euo pipefail

MODE="global"
CONFIG_OVERRIDE=""
ROOT_OVERRIDE=""

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: uninstall.sh [--global|--local] [--root <dir>]

  --global   Remove the global install (default)
  --local    Remove the install in ./.opencode
  --root     Runtime directory if you used a custom --root
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) MODE="global" ;;
    --local) MODE="local" ;;
    --root) [[ $# -ge 2 ]] || die "--root needs a value"; ROOT_OVERRIDE="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

if [[ "$MODE" == "local" ]]; then
  CONFIG="$PWD/.opencode"
else
  CONFIG="${CONFIG_OVERRIDE:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
fi
ROOT="${ROOT_OVERRIDE:-$CONFIG/forge}"

# Only remove the ~/.local/bin/forge link if it points at this install.
if [[ "$MODE" == "global" && -L "$HOME/.local/bin/forge" ]]; then
  target="$(readlink "$HOME/.local/bin/forge" || true)"
  [[ "$target" == "$ROOT/bin/forge" ]] && rm -f "$HOME/.local/bin/forge"
fi

rm -rf "$CONFIG/plugins/forge" "$CONFIG/agents/forge" "$CONFIG/commands/forge" "$ROOT"

printf 'Forge removed from %s. Project .forge/ directories were left intact.\n' "$CONFIG"
