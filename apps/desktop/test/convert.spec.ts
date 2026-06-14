import { describe, expect, it } from 'vitest';
import { normalFormOf, prepareMarkdown, reconcile } from '../src/editor/convert';

describe('verbatim protection', () => {
  it('swaps tables and raw blocks for sentinels and keeps their sources', () => {
    const source = 'para\n\n| a |\n| --- |\n| 1 |\n\n<div>raw</div>\n';
    const { markdown, sources } = prepareMarkdown(source);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain('| a |');
    expect(sources[1]).toBe('<div>raw</div>');
    expect(markdown).not.toContain('| a |');
    expect(markdown).toContain('para');
  });
});

describe('the byte-reuse reconciler', () => {
  it('keeps a document with no semantic changes byte-identical', () => {
    const source = '# Title\n\n* odd  bullet\n\nA paragraph with **bold**.\n';
    const normal = normalFormOf(source);
    expect(reconcile(source, normal)).toBe(source);
  });

  it('changes only the edited block, preserving odd bytes elsewhere', () => {
    const source = '* odd  bullet\n\nOld paragraph.\n\n> a   quote\n';
    // The editor's output is in normal form throughout, with one block edited.
    const edited = `${normalFormOf('* odd  bullet')}\n\nNew paragraph.\n\n${normalFormOf('> a   quote')}\n`;
    const result = reconcile(source, edited);
    expect(result).toContain('* odd  bullet'); // original bytes, not "- odd bullet"
    expect(result).toContain('> a   quote');
    expect(result).toContain('New paragraph.');
    expect(result).not.toContain('Old paragraph.');
  });

  it('verbatim blocks survive byte-for-byte', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const source = `before\n\n${table}\n\nafter\n`;
    const edited = `before edited\n\n${table}\n\nafter\n`;
    expect(reconcile(source, edited)).toBe(`before edited\n\n${table}\n\nafter\n`);
  });

  it('handles insertion and deletion of blocks', () => {
    const source = 'one\n\ntwo\n\nthree\n';
    expect(reconcile(source, 'one\n\nthree\n')).toBe('one\n\nthree\n');
    expect(reconcile(source, 'one\n\nnew\n\ntwo\n\nthree\n')).toBe('one\n\nnew\n\ntwo\n\nthree\n');
  });
});
