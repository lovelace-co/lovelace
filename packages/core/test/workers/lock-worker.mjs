// Acquires the project mutation lock, holds it for holdMs, then reports its
// own wall-clock enter/exit as JSON on stdout. Spawned in pairs by
// concurrency.spec.ts to prove two real OS processes racing to steal the
// same stale lock can never both hold it at once; imports the built package
// since it runs as a separate process, not through vitest's loader.
import { withMutateLock } from '../../dist/index.js';
import { join } from 'node:path';

const [root, holdMs] = process.argv.slice(2);
const lovelaceDir = join(root, '.lovelace');

// enter/exit bracket only the time actually spent inside fn (the critical
// section), not the time spent waiting to acquire the lock beforehand.
let enter = 0;
let exit = 0;
await withMutateLock(lovelaceDir, async () => {
  enter = Date.now();
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  exit = Date.now();
});
console.log(JSON.stringify({ enter, exit }));
