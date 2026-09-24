#!/usr/bin/env bash
#
# Deploy this behavior pack to the Bedrock Dedicated Server on the VM and
# hot-reload it — no server restart, no iPad reinstall.
#
#   ./tools/deploy-server.sh                       # pull latest main, build, deploy, reload
#   ./tools/deploy-server.sh --no-pull             # deploy the working tree as-is
#   ./tools/deploy-server.sh --allow-stale-version # ship a changed resource pack
#                                                  # without bumping the version
#
# Idempotent: safe to run as many times as you like.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${SERVER_DIR:-/opt/bedrock-health}"
PACK_NAME="leo-mod-health-doubler"
RP_NAME="leo-mod-health-doubler-rp"
TMUX_SESSION="${TMUX_SESSION:-health}"
# Leo's World and the TNT world each run their own tmux server, so that one
# crashing can't take the other down. Ours is on the "tnt" socket.
TMUX_SOCKET="${TMUX_SOCKET:-health}"
tmux_() { tmux -L "$TMUX_SOCKET" "$@"; }

PULL=1
ALLOW_STALE=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --allow-stale-version) ALLOW_STALE=1 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ -d "$SERVER_DIR" ]] || die "Server not found at $SERVER_DIR (set SERVER_DIR=... to override)"

# ---------------------------------------------------------------- build ----
cd "$REPO_DIR"

if [[ "$PULL" == 1 ]]; then
  say "Pulling latest main"
  git pull --ff-only origin main
fi

say "Installing dependencies"
npm ci

say "Building pack"
npm run build   # typechecks, stamps the version into manifest.json, bundles scripts

# The manifest is the single source of truth for uuid + version. Read it AFTER
# the build, because `npm run build` stamps package.json's version into it.
MANIFEST="$REPO_DIR/pack/manifest.json"
[[ -f "$MANIFEST" ]] || die "No manifest at $MANIFEST"

PACK_UUID="$(jq -r '.header.uuid' "$MANIFEST")"
PACK_VERSION="$(jq -c '.header.version' "$MANIFEST")"
PACK_LABEL="$(jq -r '.header.name' "$MANIFEST")"
[[ "$PACK_UUID" != "null" && "$PACK_VERSION" != "null" ]] || die "Manifest missing header.uuid / header.version"

RP_MANIFEST="$REPO_DIR/resource_pack/manifest.json"
[[ -f "$RP_MANIFEST" ]] || die "No resource pack manifest at $RP_MANIFEST"
RP_UUID="$(jq -r '.header.uuid' "$RP_MANIFEST")"
RP_VERSION="$(jq -c '.header.version' "$RP_MANIFEST")"
RP_LABEL="$(jq -r '.header.name' "$RP_MANIFEST")"

# --------------------------------------------------------------- deploy ----
# A *development* behavior pack is what makes BDS's `reload` pick up script
# changes; a regular behavior_packs/ install would need a full restart.
DEST="$SERVER_DIR/development_behavior_packs/$PACK_NAME"
RP_DEST="$SERVER_DIR/development_resource_packs/$RP_NAME"

mkdir -p "$DEST" "$RP_DEST"

# Work out whether anything would actually change BEFORE copying anything, so
# the guard below still has the previously deployed pack to compare against —
# and so that refusing the deploy leaves the server exactly as it was. Checking
# after copying the behaviour pack would abort half-deployed, with new game
# logic on the server and the old looks. This also tells us whether to nag
# about restarting later: `reload` reloads scripts, but NOT textures or entity
# looks — those only reach the iPads on a fresh connect.
#
# Compare CONTENT, not timestamps: --checksum, and drop rsync's attribute-only
# lines (those start with "."). The build rewrites both manifests every run, so
# a plain -a comparison reports a change on every single deploy even when not a
# byte differs — which would make this guard cry wolf until it got ignored.
RP_CHANGED="$(
  rsync -a --checksum --delete --itemize-changes --dry-run \
    "$REPO_DIR/resource_pack/" "$RP_DEST/" | grep -vE '^\.' | grep -c . || true
)"

# ---- guard: a changed resource pack MUST get a new version number ----------
# Minecraft caches resource packs by uuid + version. Ship a changed pack under
# a version the iPads already hold and they keep using their cached copy — no
# error, no warning. New mobs come out invisible and changed textures still
# look old, while the behaviour pack (server side) works perfectly. That split
# is maddening to debug, so refuse the deploy instead.
DEPLOYED_RP_MANIFEST="$RP_DEST/manifest.json"
if [[ "$RP_CHANGED" -gt 0 && "$ALLOW_STALE" == 0 && -f "$DEPLOYED_RP_MANIFEST" ]]; then
  DEPLOYED_RP_VERSION="$(jq -c '.header.version' "$DEPLOYED_RP_MANIFEST" 2>/dev/null || echo 'null')"
  if [[ "$DEPLOYED_RP_VERSION" == "$RP_VERSION" ]]; then
    die "$(cat <<EOF
The resource pack changed, but its version is still $RP_VERSION — the same
version already deployed. The iPads would keep using their cached copy and
never see this change.

Bump the version, which stamps both manifests, then deploy again:

    npm version patch && ./tools/deploy-server.sh

If you're certain no client needs the change (a comment-only edit, say):

    ./tools/deploy-server.sh --allow-stale-version
EOF
)"
  fi
fi

say "Copying behaviour pack -> $DEST"
rsync -a --delete "$REPO_DIR/pack/" "$DEST/"

say "Copying resource pack -> $RP_DEST"
rsync -a --delete "$REPO_DIR/resource_pack/" "$RP_DEST/"

# ------------------------------------------------- activate for the world ----
# world_behavior_packs.json pins an exact uuid + version. Both change on every
# release, so this file MUST be re-synced from the manifest on every deploy or
# the world silently keeps running the old pack (or none at all).
LEVEL_NAME="$(grep -E '^level-name=' "$SERVER_DIR/server.properties" | head -1 | cut -d= -f2-)"
LEVEL_NAME="${LEVEL_NAME:-Leos World}"
WORLD_DIR="$SERVER_DIR/worlds/$LEVEL_NAME"
[[ -d "$WORLD_DIR" ]] || die "World not found at $WORLD_DIR — has the server been started at least once?"

# Preserve any other packs that may be active; replace only our entry.
activate() {
  local file="$1" uuid="$2" version="$3" label="$4"
  local others='[]'
  if [[ -f "$file" ]]; then
    others="$(jq --arg u "$uuid" '[.[] | select(.pack_id != $u)]' "$file" 2>/dev/null || echo '[]')"
  fi
  say "Activating $label ($uuid @ $version)"
  jq -n --argjson others "$others" --arg u "$uuid" --argjson v "$version" \
    '$others + [{pack_id: $u, version: $v}]' > "$file.tmp"
  mv "$file.tmp" "$file"
}

activate "$WORLD_DIR/world_behavior_packs.json" "$PACK_UUID" "$PACK_VERSION" "$PACK_LABEL"
activate "$WORLD_DIR/world_resource_packs.json" "$RP_UUID" "$RP_VERSION" "$RP_LABEL"

# ---------------------------------------------------------------- reload ----
if tmux_ has-session -t "$TMUX_SESSION" 2>/dev/null; then
  say "Hot-reloading the running server"
  tmux_ send-keys -t "$TMUX_SESSION" reload Enter
  sleep 3
  echo
  echo "--- server console (last 15 lines) ---"
  tmux_ capture-pane -p -t "$TMUX_SESSION" | grep -v '^$' | tail -15
  echo "--------------------------------------"
  echo
  echo "Watch the console live with:  tmux -L $TMUX_SOCKET attach -t $TMUX_SESSION   (detach: Ctrl-B then D)"

  if [[ "${RP_CHANGED:-0}" -gt 0 ]]; then
    echo
    printf '\033[1;33m%s\033[0m\n' "NOTE: the resource pack changed (textures / how things look)."
    printf '\033[1;33m%s\033[0m\n' "      'reload' does not push those to the iPads. To see them:"
    printf '\033[1;33m%s\033[0m\n' "        sudo systemctl restart bedrock-health   # then rejoin on the iPads"
    printf '\033[1;33m%s\033[0m\n' "      Script-only changes never need this."
  fi
else
  say "Server is not running — deployed, but not reloaded"
  echo "Start it with:  sudo systemctl start bedrock-server"
fi

say "Deployed $PACK_LABEL"
