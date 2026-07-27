import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Incremented on every call so two atomic writes from the same process in
// the same tick (same pid) never collide on the same temp name.
let counter = 0;

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
  renameSync(tmp, file);
}
