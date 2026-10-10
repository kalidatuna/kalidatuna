#!/usr/bin/env bash
# Downloads and builds Natron's free OpenFX plugin collections (openfx-misc: "Misc" and "CImg",
# about 140 effects: blurs, glows, keyers, color tools, transforms, distortions, time effects…)
# and installs them where MotionForge looks for plugins.
#
#   ./scripts/install-natron-plugins.sh            build + install to ~/.local/share/MotionForge/OFX/Plugins
#   ./scripts/install-natron-plugins.sh --system   install to /usr/OFX/Plugins (shared with Natron/Resolve; needs sudo)
set -euo pipefail

# Run a command as root (directly if we already are).
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

DEST="${XDG_DATA_HOME:-$HOME/.local/share}/MotionForge/OFX/Plugins"
SUDO=""
if [[ " $* " == *" --system "* ]]; then
  DEST="/usr/OFX/Plugins"
  SUDO="as_root"
fi
WORK="${TMPDIR:-/tmp}/motionforge-ofx-build"
JOBS="$(nproc 2>/dev/null || echo 4)"

if command -v apt-get >/dev/null; then
  echo "==> Installing build tools (git, compiler, OpenGL headers)"
  as_root apt-get install -y git build-essential libgl1-mesa-dev >/dev/null
fi

rm -rf "$WORK"
mkdir -p "$WORK"
echo "==> Downloading openfx-misc"
git clone --quiet --depth 1 --recurse-submodules --shallow-submodules \
  https://github.com/NatronGitHub/openfx-misc "$WORK/openfx-misc"

cd "$WORK/openfx-misc"
for part in Misc CImg; do
  echo "==> Building $part (this takes a few minutes)"
  make -j"$JOBS" CONFIG=release -C "$part" >"$WORK/$part.log" 2>&1 || {
    echo "Build of $part failed; see $WORK/$part.log"
    exit 1
  }
done

echo "==> Installing to $DEST"
$SUDO mkdir -p "$DEST"
for part in Misc CImg; do
  $SUDO rm -rf "$DEST/$part.ofx.bundle"
  $SUDO cp -r "$part/Linux-64-release/$part.ofx.bundle" "$DEST/"
done
echo
echo "Done. Start MotionForge: the plugins appear in the Effect menu and in Effects & Presets"
echo "under \"OpenFX: …\" categories. Effect ▸ Manage OpenFX Plugins shows what loaded."
