import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURE_ROOT = resolve(__dirname, '../../../examples/demo-project');

/** Copies the demo project into a temp dir so tests can corrupt it freely. */
export function tempFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-test-'));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function corrupt(root: string, rel: string, fn: (text: string) => string): void {
  const abs = join(root, rel);
  writeFileSync(abs, fn(readFileSync(abs, 'utf8')));
}

export const FIXED_NOW = () => new Date('2026-06-10T12:00:00Z');
