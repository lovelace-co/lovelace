import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURE_ROOT = resolve(__dirname, '../../../examples/demo-project');

export function tempFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-mcp-test-'));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
