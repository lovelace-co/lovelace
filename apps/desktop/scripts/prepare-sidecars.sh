#!/bin/sh
# Compiles the sidecar binaries with Bun and places them where the Tauri
# bundler expects them: src-tauri/binaries/<name>-<target-triple>.
# Takes an optional Rust target triple as $1 to cross-compile for another
# platform; defaults to the rustc host triple. POSIX sh, runs under bash on
# every CI platform including Windows.
set -e
cd "$(dirname "$0")/.."
TRIPLE="$1"
if [ -z "$TRIPLE" ]; then
  TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
fi
if [ -z "$TRIPLE" ]; then
  echo "rustc not found; install the Rust toolchain first" >&2
  exit 1
fi

EXT=""
case "$TRIPLE" in
  aarch64-apple-darwin)
    BUN_TARGET=bun-darwin-arm64
    ;;
  x86_64-apple-darwin)
    BUN_TARGET=bun-darwin-x64
    ;;
  x86_64-pc-windows-msvc)
    BUN_TARGET=bun-windows-x64
    EXT=".exe"
    ;;
  x86_64-unknown-linux-gnu)
    BUN_TARGET=bun-linux-x64
    ;;
  *)
    echo "unknown target triple: $TRIPLE (add a mapping in prepare-sidecars.sh)" >&2
    exit 1
    ;;
esac

BUN_COMPILE_TARGET="$BUN_TARGET" pnpm --filter @lovelace/mcp bundle
mkdir -p src-tauri/binaries
for name in lovelace-host lovelace-agent lovelace-mcp; do
  cp "../../packages/mcp/dist-bin/$name$EXT" "src-tauri/binaries/$name-$TRIPLE$EXT"
done
echo "sidecars staged for $TRIPLE"
