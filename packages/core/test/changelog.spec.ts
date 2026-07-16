import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changelogBetween, SPEC_CHANGELOG } from '../src/index.js';

const SPEC_MD = resolve(__dirname, '../../../SPEC.md');

/** Parses SPEC.md's "Changes by version:" bullet list into the same shape as SPEC_CHANGELOG. */
function parseSpecChangelog(): { version: string; description: string }[] {
  const text = readFileSync(SPEC_MD, 'utf8');
  const marker = 'Changes by version:';
  const start = text.indexOf(marker);
  if (start === -1) throw new Error('SPEC.md is missing the "Changes by version:" marker');
  // The section runs to the next markdown heading (the first "## " after the marker).
  const rest = text.slice(start + marker.length);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);
  const entries: { version: string; description: string }[] = [];
  const lineRe = /^- `(\d+\.\d+\.\d+)`: (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(section))) {
    entries.push({ version: match[1]!, description: match[2]! });
  }
  return entries;
}

describe('SPEC_CHANGELOG', () => {
  it('matches SPEC.md\'s changelog exactly, so the two never silently drift apart', () => {
    const parsed = parseSpecChangelog();
    expect(parsed).toHaveLength(SPEC_CHANGELOG.length);
    expect(parsed).toEqual(SPEC_CHANGELOG);
  });
});

describe('changelogBetween', () => {
  it('excludes the declared version itself and includes everything up to and including target', () => {
    const versions = changelogBetween('2.0.0', '3.0.0').map((e) => e.version);
    expect(versions).toEqual(['2.1.0', '3.0.0']);
  });

  it('excludes an entry exactly matching declared (exclusive lower bound)', () => {
    const versions = changelogBetween('2.1.0', '3.0.0').map((e) => e.version);
    expect(versions).toEqual(['3.0.0']);
    expect(versions).not.toContain('2.1.0');
  });

  it('never includes entries above target, even when later versions exist in the changelog', () => {
    const versions = changelogBetween('2.0.0', '3.0.0').map((e) => e.version);
    expect(versions).not.toContain('3.1.0');
    expect(versions).not.toContain('3.2.0');
  });

  it('returns entries in ascending version order', () => {
    const versions = changelogBetween('1.0.0', '2.0.0').map((e) => e.version);
    expect(versions).toEqual(['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '2.0.0']);
  });
});
