#!/usr/bin/env bash
# Forge for OpenCode installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Sami001-OG/forge-opencode/main/install.sh | bash
#   ./install.sh --local
#   ./install.sh --ref v0.7.0 --no-bin
#
# Global install (default) puts the runtime in ~/.config/opencode/forge, the plugin in
# ~/.config/opencode/plugins/forge, and the /forge/* commands and forge/* subagents in the
# matching global config directories. Project install (--local) uses ./.opencode instead.
set -euo pipefail

REPO="${FORGE_REPO:-Sami001-OG/forge-opencode}"
REF="${FORGE_REF:-main}"
MODE="global"
WITH_BIN=1
CONFIG_OVERRIDE=""
ROOT_OVERRIDE=""

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  warning:\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Forge for OpenCode installer

Usage: install.sh [options]

  --global          Install for every project (default)
  --local           Install into ./.opencode for this project only
  --ref <ref>       Git branch, tag, or commit to download (default: main)
  --root <dir>      Override the runtime install directory
  --no-bin          Do not link the `forge` command into ~/.local/bin
  -h, --help        Show this help

Environment:
  FORGE_REPO        GitHub repository (default: Sami001-OG/forge-opencode)
  FORGE_REF         Same as --ref
  XDG_CONFIG_HOME   Config root used for global installs

Requirements: OpenCode 2.x, Node.js 18+, curl + tar (only when run from a pipe).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) MODE="global" ;;
    --local) MODE="local" ;;
    --ref) [[ $# -ge 2 ]] || die "--ref needs a value"; REF="$2"; shift ;;
    --root) [[ $# -ge 2 ]] || die "--root needs a value"; ROOT_OVERRIDE="$2"; shift ;;
    --no-bin) WITH_BIN=0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

command -v node >/dev/null 2>&1 || die "Node.js 18+ is required (forge runs on Node, not Bun)."
node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 18 ? 0 : 1)' \
  || die "Node.js 18+ is required (found $(node --version))."

if command -v opencode >/dev/null 2>&1; then
  version="$(opencode --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  if [[ -n "$version" && "${version%%.*}" -lt 2 ]]; then
    warn "Forge targets OpenCode 2.x (found $version). The plugin API will not match on 1.x."
  fi
else
  warn "opencode is not on PATH yet. Install it and restart the app after this script."
fi

if [[ "$MODE" == "local" ]]; then
  CONFIG="$PWD/.opencode"
else
  CONFIG="${CONFIG_OVERRIDE:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
fi
ROOT="${ROOT_OVERRIDE:-$CONFIG/forge}"

# Resolve the source: a checkout when this file is on disk, otherwise a tarball.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
fi

TMP=""
cleanup() { if [[ -n "$TMP" && -d "$TMP" ]]; then rm -rf "$TMP"; fi; }
trap cleanup EXIT

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/scripts/forge.mjs" ]]; then
  SRC="$SCRIPT_DIR"
else
  command -v curl >/dev/null 2>&1 || die "curl is required when installing from a pipe."
  command -v tar >/dev/null 2>&1 || die "tar is required when installing from a pipe."
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/forge-install.XXXXXX")"
  bold "Downloading $REPO@$REF"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/source.tgz" \
    || die "could not download $REPO@$REF"
  tar -xzf "$TMP/source.tgz" -C "$TMP"
  GATE_FILE="$(find "$TMP" -maxdepth 5 -type f -path '*/scripts/forge.mjs' | head -n1)"
  [[ -n "$GATE_FILE" ]] || die "the downloaded archive does not look like Forge"
  SRC="${GATE_FILE%/scripts/forge.mjs}"
fi

[[ -f "$SRC/plugin/index.ts" ]] || die "source is missing plugin/index.ts"

bold "Installing Forge for OpenCode"
info "source  $SRC"
info "config  $CONFIG"
info "runtime $ROOT"

STAGE="$CONFIG/.forge-staging.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$SRC/scripts" "$SRC/catalog" "$SRC/plugin" "$SRC/LICENSE" "$STAGE/"
mkdir -p "$STAGE/agents" "$STAGE/commands"
cp "$SRC/agents/forge/"*.md "$STAGE/agents/"
cp "$SRC/commands/forge/"*.md "$STAGE/commands/"

# Bake the absolute runtime path into every prompt template and into the plugin.
find "$STAGE/agents" "$STAGE/commands" -type f -name '*.md' -print0 \
  | while IFS= read -r -d '' file; do
      sed "s|{{FORGE_ROOT}}|$ROOT|g" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    done
sed "s|__FORGE_ROOT__|$ROOT|g" "$SRC/plugin/index.ts" > "$STAGE/plugin/index.ts"

mkdir -p "$CONFIG"
rm -rf "$ROOT"
mv "$STAGE" "$ROOT"

# Plugin discovery: OpenCode loads <config>/plugins/<name>/index.ts automatically.
rm -rf "$CONFIG/plugins/forge"
mkdir -p "$CONFIG/plugins/forge"
sed "s|__FORGE_ROOT__|$ROOT|g" "$SRC/plugin/index.ts" > "$CONFIG/plugins/forge/index.ts"

# Agents and commands live where OpenCode discovers them, namespaced under forge/.
rm -rf "$CONFIG/agents/forge" "$CONFIG/commands/forge"
mkdir -p "$CONFIG/agents/forge" "$CONFIG/commands/forge"
cp "$ROOT/agents/"*.md "$CONFIG/agents/forge/"
cp "$ROOT/commands/"*.md "$CONFIG/commands/forge/"

# A stable `forge` shim that works even when ~/.local/bin is not on PATH.
mkdir -p "$ROOT/bin"
cat > "$ROOT/bin/forge" <<EOF
#!/bin/sh
exec node "$ROOT/scripts/forge.mjs" "\$@"
EOF
chmod +x "$ROOT/bin/forge"

if [[ "$MODE" == "global" && "$WITH_BIN" == "1" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$ROOT/bin/forge" "$HOME/.local/bin/forge"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "add $HOME/.local/bin to PATH to use the 'forge' command directly." ;;
  esac
fi

cat <<EOF

$(bold "Forge is installed.")
  Commands  /forge/build  /forge/ui  /forge/tweak  /forge/status  /forge/abort  /forge/doctor
  Subagents forge/planner  forge/supervisor  forge/critic  forge/toolsmith
  CLI       "$ROOT/bin/forge" (or: forge, if ~/.local/bin is on PATH)

Start in any project:
  /forge/build a landing page and waitlist for a smart water bottle

OpenCode reloads commands, agents, and plugins automatically. If /forge/build does not appear,
run /reload (or restart OpenCode once).
EOF
