import { describe, expect, it } from 'vitest';
import { normalizeEscapedFences, matchFenceOpen, isFenceClose, extractInnerMermaidFence, collapseNestedMermaidFences } from '../src/lib/fences';

describe('normalizeEscapedFences', () => {
  it('rewrites Lexical-escaped fences into real Markdown fences', () => {
    const escaped = ['text', '', '\\`\\`\\`mermaid', '', 'flowchart LR', '', 'A --> B', '', '\\`\\`\\`', ''].join(
      '\n',
    );
    const out = normalizeEscapedFences(escaped);
    expect(out).toContain('```mermaid\n');
    expect(out).toContain('\n```\n');
    expect(out).not.toContain('\\`');
  });

  it('recovers an escaped mermaid block (inline fixture)', () => {
    // Simulates what Lexical writes when a mermaid fence is pasted into a paragraph.
    const escaped = [
      'Some text before.',
      '',
      '\\`\\`\\`mermaid',
      'flowchart LR',
      '  A --> B',
      '\\`\\`\\`',
      '',
    ].join('\n');
    expect(escaped).toMatch(/\\`\\`\\`mermaid/);
    const out = normalizeEscapedFences(escaped);
    expect(out).toContain('```mermaid');
    expect(out).toMatch(/\n```\n/);
    expect(out).not.toContain('\\`');
  });
});

describe('matchFenceOpen', () => {
  it('matches a standard 3-backtick opener with no lang', () => {
    const result = matchFenceOpen('```');
    expect(result).toEqual({ char: '`', length: 3, lang: '' });
  });

  it('matches a 3-backtick opener with a lang tag', () => {
    const result = matchFenceOpen('```mermaid');
    expect(result).toEqual({ char: '`', length: 3, lang: 'mermaid' });
  });

  it('matches a 4-backtick opener with no lang', () => {
    const result = matchFenceOpen('````');
    expect(result).toEqual({ char: '`', length: 4, lang: '' });
  });

  it('matches a tilde fence opener', () => {
    const result = matchFenceOpen('~~~typescript');
    expect(result).toEqual({ char: '~', length: 3, lang: 'typescript' });
  });

  it('returns null for a regular paragraph line', () => {
    expect(matchFenceOpen('hello world')).toBeNull();
  });

  it('returns null for two backticks (too short)', () => {
    expect(matchFenceOpen('``')).toBeNull();
  });
});

describe('isFenceClose', () => {
  it('closes a 3-backtick fence with exactly 3 backticks', () => {
    const open = { char: '`' as const, length: 3, lang: '' };
    expect(isFenceClose('```', open)).toBe(true);
  });

  it('closes a 3-backtick fence with 4 backticks (>= length)', () => {
    const open = { char: '`' as const, length: 3, lang: '' };
    expect(isFenceClose('````', open)).toBe(true);
  });

  it('does NOT close a 4-backtick fence with only 3 backticks', () => {
    const open = { char: '`' as const, length: 4, lang: '' };
    expect(isFenceClose('```', open)).toBe(false);
  });

  it('does NOT close a backtick fence with a tilde line', () => {
    const open = { char: '`' as const, length: 3, lang: '' };
    expect(isFenceClose('~~~', open)).toBe(false);
  });

  it('does NOT close when the line has a lang tag (info string present)', () => {
    const open = { char: '`' as const, length: 3, lang: '' };
    expect(isFenceClose('```mermaid', open)).toBe(false);
  });

  it('closes a tilde fence with matching length', () => {
    const open = { char: '~' as const, length: 3, lang: '' };
    expect(isFenceClose('~~~', open)).toBe(true);
  });
});

describe('extractInnerMermaidFence', () => {
  it('extracts diagram source from a complete ```mermaid body', () => {
    const body = '```mermaid\nflowchart LR\n  A --> B\n```';
    expect(extractInnerMermaidFence(body)).toBe('flowchart LR\n  A --> B');
  });

  it('extracts when body has leading and trailing blank lines', () => {
    const body = '\n\n```mermaid\ngraph TD\n  X --> Y\n```\n\n';
    expect(extractInnerMermaidFence(body)).toBe('graph TD\n  X --> Y');
  });

  it('accepts a tilde inner fence with mermaid lang', () => {
    const body = '~~~mermaid\nflowchart LR\n  A --> B\n~~~';
    expect(extractInnerMermaidFence(body)).toBe('flowchart LR\n  A --> B');
  });

  it('accepts a 4-backtick inner fence with mermaid lang', () => {
    const body = '````mermaid\ngraph TD\n  A --> B\n````';
    expect(extractInnerMermaidFence(body)).toBe('graph TD\n  A --> B');
  });

  it('is case-insensitive on the inner lang', () => {
    const body = '```Mermaid\nflowchart LR\n  A --> B\n```';
    expect(extractInnerMermaidFence(body)).toBe('flowchart LR\n  A --> B');
  });

  it('returns null when inner lang is not mermaid', () => {
    expect(extractInnerMermaidFence('```js\nconst x = 1;\n```')).toBeNull();
  });

  it('returns null when body is plain text (no fence)', () => {
    expect(extractInnerMermaidFence('flowchart LR\n  A --> B')).toBeNull();
  });

  it('returns null when inner fence is unclosed', () => {
    expect(extractInnerMermaidFence('```mermaid\nflowchart LR\n  A --> B')).toBeNull();
  });

  it('returns null when there are non-blank lines after the inner close', () => {
    const body = '```mermaid\nflowchart LR\n  A --> B\n```\nextra content';
    expect(extractInnerMermaidFence(body)).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(extractInnerMermaidFence('')).toBeNull();
    expect(extractInnerMermaidFence('   \n\n   ')).toBeNull();
  });
});

describe('collapseNestedMermaidFences', () => {
  it('collapses an exact 4-backtick outer + ```mermaid inner into a clean fence', () => {
    const input = '````\n```mermaid\nflowchart LR\n  A --> B\n```\n````';
    const out = collapseNestedMermaidFences(input);
    expect(out).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
  });

  it('is idempotent: an already-clean ```mermaid fence is unchanged', () => {
    const input = '```mermaid\nflowchart LR\n  A --> B\n```';
    expect(collapseNestedMermaidFences(input)).toBe(input);
  });

  it('does NOT collapse a non-mermaid inner fence (```js)', () => {
    const input = '````\n```js\nconst x = 1;\n```\n````';
    expect(collapseNestedMermaidFences(input)).toBe(input);
  });

  it('does NOT collapse when outer lang is a specific language (e.g. typescript)', () => {
    const input = '````typescript\n```mermaid\nflowchart LR\n  A --> B\n```\n````';
    expect(collapseNestedMermaidFences(input)).toBe(input);
  });

  it('preserves surrounding non-fence content byte-for-byte', () => {
    const input = 'Before.\n\n````\n```mermaid\ngraph TD\n  X --> Y\n```\n````\n\nAfter.';
    const out = collapseNestedMermaidFences(input);
    expect(out).toContain('Before.\n\n');
    expect(out).toContain('\n\nAfter.');
    expect(out).toContain('```mermaid\ngraph TD\n  X --> Y\n```');
  });

  it('collapses a mermaid-outer double-wrapped fence (longer outer, strips redundant shell)', () => {
    // In CommonMark a double-wrap requires a longer outer fence so the inner
    // close does not prematurely close the outer block.
    const input = '````mermaid\n```mermaid\nflowchart LR\n  A --> B\n```\n````';
    const out = collapseNestedMermaidFences(input);
    // Outer mermaid + inner mermaid collapses to a single clean fence.
    expect(out).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
  });

  it('handles the OVERVIEW.md exact nested pattern', () => {
    const input = [
      '````',
      '```mermaid',
      'flowchart TB',
      '    A --> B',
      '```',
      '````',
    ].join('\n');
    const out = collapseNestedMermaidFences(input);
    expect(out).toBe('```mermaid\nflowchart TB\n    A --> B\n```');
  });

  it('leaves a source with no fences unchanged', () => {
    const input = 'Just a paragraph.\n\nAnother paragraph.';
    expect(collapseNestedMermaidFences(input)).toBe(input);
  });
});
