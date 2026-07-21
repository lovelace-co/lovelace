import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const FIXTURE_ROOT = resolve(__dirname, '../../../examples/demo-project');

/**
 * Local residue directories/files that may exist in the demo-project from a
 * prior Claude Code integration install. They are untracked and should not
 * pollute integration tests that write and check these files from scratch.
 */
const CLAUDE_RESIDUE = new Set(['.claude', 'CLAUDE.md', '.mcp.json']);

export function tempFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-mcp-test-'));
  cpSync(FIXTURE_ROOT, root, {
    recursive: true,
    filter: (src) => {
      // cpSync hands the filter OS-native separators (backslashes on
      // Windows), so derive the basename with node:path, never split('/').
      return !CLAUDE_RESIDUE.has(basename(src));
    },
  });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
