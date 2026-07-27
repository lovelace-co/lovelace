import { existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Incremented on every call so two atomic writes from the same process in
// the same tick (same pid) never collide on the same temp name.
let counter = 0;

// Windows refuses a rename onto a file another handle still has open, so a
// reader as ordinary as the desktop app polling index.json, or a virus
// scanner or the search indexer touching a file it just saw change, makes
// the rename below fail even though nothing is wrong. POSIX has no such
// rule. The failure is transient by nature (those handles close in
// milliseconds), so the rename is retried briefly rather than surfaced as a
// mutation error. EBUSY and EACCES join EPERM because Windows reports the
// same contention under all three depending on who holds the handle.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 12;

/**
 * Blocks this thread for `ms`. writeFileAtomic is synchronous and is called
 * from synchronous write paths all through core, so waiting cannot be done
 * with a promise here; Atomics.wait on a throwaway buffer is the one sync
 * sleep Node offers that does not burn the CPU.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renames `tmp` over `file`, retrying the transient Windows contention
 * failures described above with a short backoff (about 130 ms in total
 * across every attempt). Anything else, or a target still contended once
 * the attempts run out, throws as before, with the temp file cleaned up so
 * a failed write leaves no litter behind.
 */
function renameWithRetry(tmp: string, file: string): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // Best effort; the rename failure is what the caller needs.
        }
        throw e;
      }
      sleepSync(Math.min(attempt * 2, 20));
    }
  }
}

/**
 * Writes `content` to `file` atomically. A plain writeFileSync truncates the
 * target then streams the new bytes in, so a concurrent reader can observe
 * an empty or partial file mid-write; this instead writes to a temp file in
 * the same directory (so the rename below stays on one filesystem, which is
 * what makes it atomic) and renames it over the target, so a reader only
 * ever sees the old content in full or the new content in full. The temp
 * name always ends in .tmp, never .md or .json, so it stays invisible to
 * listMarkdown and the presence reader while the write is in flight. When
 * the target already exists, its file mode is carried onto the temp file
 * first, so a chmod-ed file (for example made read-only, or executable)
 * does not silently fall back to the process umask default on rewrite.
 */
export function writeFileAtomic(file: string, content: string): void {
  const dir = dirname(file);
  const name = basename(file);
  counter += 1;
  const tmp = join(dir, `.${name}.${process.pid}.${counter}.tmp`);
  // statSync's mode carries the file-type bits (S_IFREG etc.) alongside the
  // permission bits; only the low 12 bits are meaningful to writeFileSync's
  // mode option, and passing the file-type bits through is unreliable.
  const mode = existsSync(file) ? statSync(file).mode & 0o7777 : undefined;
  writeFileSync(tmp, content, mode !== undefined ? { mode } : undefined);
  renameWithRetry(tmp, file);
}
