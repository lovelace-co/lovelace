import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from './types.js';

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Assigns the next sequential ID for a prefix using a counter file under
 * state/counters/ guarded by an exclusive lock directory. Safe against a
 * concurrently running watcher or a second process: mkdir is atomic.
 * Missing counters are rebuilt by scanning existing entity IDs.
 */
export async function nextId(
  lovelaceDir: string,
  manifest: Manifest,
  prefix: string,
): Promise<string> {
  const countersDir = join(lovelaceDir, manifest.paths.state, 'counters');
  mkdirSync(countersDir, { recursive: true });
  const counterFile = join(countersDir, prefix);
  const lockDir = `${counterFile}.lock`;

  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for ID lock on prefix ${prefix}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  try {
    let last = 0;
    if (existsSync(counterFile)) {
      last = Number.parseInt(readFileSync(counterFile, 'utf8').trim(), 10) || 0;
    } else {
      last = scanHighestId(lovelaceDir, manifest, prefix);
    }
    const next = last + 1;
    writeFileSync(counterFile, `${next}\n`);
    return `${prefix}-${String(next).padStart(4, '0')}`;
  } finally {
    rmdirSync(lockDir);
  }
}

/** Highest existing number for a prefix, found by scanning entity filenames. */
export function scanHighestId(lovelaceDir: string, manifest: Manifest, prefix: string): number {
  const dirs = [
    join(lovelaceDir, manifest.paths.tickets),
    join(lovelaceDir, manifest.paths.sessions),
    join(lovelaceDir, manifest.paths.briefs),
  ];
  const re = new RegExp(`^${prefix}-(\\d+)\\.md$`);
  let highest = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      } else {
        const m = re.exec(entry.name);
        if (m) highest = Math.max(highest, Number.parseInt(m[1] ?? '0', 10));
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return highest;
}
