import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, FrontmatterError, loadProject, validateProject } from '../src/index.js';
import { tempFixture, FIXED_NOW } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

/** Simulates a Windows checkout (autocrlf) or a Windows editor's save. */
function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r\n');
}

// Windows checks out this repo's LF-committed fixtures as CRLF by default
// (no .gitattributes forces otherwise), and a hand-edited file can carry
// CRLF regardless of platform. parseFrontmatter must read both the same way
// the file's own line count implies, while never mixing the two: the body's
// bytes are exactly what was on disk, and a mutation always rewrites the
// frontmatter as LF (see mutate.spec.ts's byte-identity tests for the write
// side; this file covers reads).
describe('parseFrontmatter line-ending tolerance', () => {
  it('parses an LF file (baseline, unchanged from before)', () => {
    const text = '---\nid: T-0001\ntitle: Example\n---\nLine one.\nLine two.\n';
    const parsed = parseFrontmatter(text);
    expect(parsed.data).toEqual({ id: 'T-0001', title: 'Example' });
    expect(parsed.body).toBe('Line one.\nLine two.\n');
    expect(parsed.bodyLine).toBe(5);
    expect(parsed.keyLines.get('id')).toBe(2);
    expect(parsed.keyLines.get('title')).toBe(3);
  });

  it('parses a CRLF file to the same data, body line and key lines as its LF equivalent', () => {
    const lf = '---\nid: T-0001\ntitle: Example\n---\nLine one.\nLine two.\n';
    const parsedLf = parseFrontmatter(lf);
    const parsedCrlf = parseFrontmatter(toCrlf(lf));
    expect(parsedCrlf.data).toEqual(parsedLf.data);
    expect(parsedCrlf.bodyLine).toBe(parsedLf.bodyLine);
    expect(parsedCrlf.keyLines.get('id')).toBe(parsedLf.keyLines.get('id'));
    expect(parsedCrlf.keyLines.get('title')).toBe(parsedLf.keyLines.get('title'));
  });

  it('recovers a CRLF body byte-identical: \\r\\n survives, it is not normalised to \\n', () => {
    const crlf = '---\r\nid: T-0001\r\ntitle: Example\r\n---\r\nLine one.\r\nLine two.\r\n';
    const parsed = parseFrontmatter(crlf);
    expect(parsed.body).toBe('Line one.\r\nLine two.\r\n');
  });

  it('recovers an LF body byte-identical (no regression from slicing by offset instead of rejoining lines)', () => {
    const lf = '---\nid: T-0001\n---\nLine one.\nLine two.\n';
    const parsed = parseFrontmatter(lf);
    expect(parsed.body).toBe('Line one.\nLine two.\n');
  });

  it('reports the same message and line number for malformed YAML whether the file is LF or CRLF', () => {
    const lf = '---\nid: T-0001\n  bad   indentation: [unclosed\n---\nBody.\n';
    let lfError: FrontmatterError | undefined;
    let crlfError: FrontmatterError | undefined;
    try {
      parseFrontmatter(lf);
    } catch (e) {
      lfError = e as FrontmatterError;
    }
    try {
      parseFrontmatter(toCrlf(lf));
    } catch (e) {
      crlfError = e as FrontmatterError;
    }
    expect(lfError).toBeInstanceOf(FrontmatterError);
    expect(crlfError).toBeInstanceOf(FrontmatterError);
    expect(crlfError?.line).toBe(lfError?.line);
    expect(crlfError?.message).toBe(lfError?.message);
  });

  it('still reports a missing frontmatter block for a genuinely malformed CRLF file', () => {
    expect(() => parseFrontmatter('id: T-0001\r\ntitle: Example\r\n')).toThrowError(
      /file must start with a --- frontmatter block/,
    );
  });

  it('still reports an unclosed frontmatter block for a CRLF file missing the closing marker', () => {
    expect(() => parseFrontmatter('---\r\nid: T-0001\r\nBody with no closing marker.\r\n')).toThrowError(
      /frontmatter block is not closed with ---/,
    );
  });

  it('a CRLF ticket file loads, parses and validates cleanly through the full project pipeline', () => {
    const root = fixture();
    const ticketPath = join(root, '.lovelace/tickets/T-0002.md');
    writeFileSync(ticketPath, toCrlf(readFileSync(ticketPath, 'utf8')));

    const project = loadProject(root);
    expect(project.tickets.map((t) => t.id)).toContain('T-0002');
    const issues = validateProject(project, { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    // The body read back through the project pipeline still carries the
    // CRLF it was written with.
    const ticket = project.tickets.find((t) => t.id === 'T-0002');
    expect(ticket?.body).toContain('\r\n');
  });
});
