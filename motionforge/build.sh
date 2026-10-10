#!/usr/bin/env bash
# Build MotionForge on Ubuntu / Linux Mint / Debian.
#   ./build.sh            build into ./build (Release)
#   ./build.sh --deps     also install build dependencies with apt (needs sudo)
#   ./build.sh --deb      also produce a .deb package in ./build
#   ./build.sh --plugins  also build + install Natron's free OpenFX plugins (~140 effects)
set -euo pipefail

# Run a command as root (directly if we already are).
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }
cd "$(dirname "$0")"

if [[ " $* " == *" --deps "* ]]; then
  as_root apt-get update
  as_root apt-get install -y build-essential cmake ninja-build pkg-config \
    qt6-base-dev qt6-declarative-dev qt6-multimedia-dev libgl1-mesa-dev \
    libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev
fi

cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
QT_QPA_PLATFORM=offscreen ctest --test-dir build --output-on-failure

if [[ " $* " == *" --deb "* ]]; then
  (cd build && cpack -G DEB)
  ls -1 build/*.deb
fi

if [[ " $* " == *" --plugins "* ]]; then
  ./scripts/install-natron-plugins.sh
fi

echo
echo "Built: ./build/motionforge   (try: ./build/motionforge --sample)"
