#!/bin/sh
# Compiles the sidecar binaries with Bun and places them where the Tauri
# bundler expects them: src-tauri/binaries/<name>-<target-triple>.
set -e
cd "$(dirname "$0")/.."
TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
if [ -z "$TRIPLE" ]; then
  echo "rustc not found; install the Rust toolchain first" >&2
  exit 1
fi
pnpm --filter @lovelace/mcp bundle
mkdir -p src-tauri/binaries
for name in lovelace-host lovelace-agent lovelace-mcp; do
  cp "../../packages/mcp/dist-bin/$name" "src-tauri/binaries/$name-$TRIPLE"
done
echo "sidecars staged for $TRIPLE"
