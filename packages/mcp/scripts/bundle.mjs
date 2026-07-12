#!/usr/bin/env node
/**
 * Compiles the three sidecar binaries with `bun build --compile`. Plain
 * Node, no dependencies, so it runs the same way on every CI runner.
 *
 * Set BUN_COMPILE_TARGET to cross-compile (a Bun target such as
 * bun-darwin-arm64, bun-darwin-x64, bun-windows-x64 or bun-linux-x64).
 * Leave it unset to compile for the machine Bun is running on. Bun appends
 * .exe to the output file itself when the target is Windows; this script
 * does not add it.
 */
import { spawnSync } from 'node:child_process';

const target = process.env.BUN_COMPILE_TARGET;

const entries = [
  ['src/host.ts', 'dist-bin/lovelace-host'],
  ['src/helper.ts', 'dist-bin/lovelace-agent'],
  ['src/server.ts', 'dist-bin/lovelace-mcp'],
];

for (const [entry, outfile] of entries) {
  const args = ['build', entry, '--compile', '--outfile', outfile];
  if (target) {
    args.push(`--target=${target}`);
  }
  const result = spawnSync('bun', args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`failed to run bun build for ${entry}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
