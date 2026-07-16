import { createHeadlessEditor } from '@lexical/headless';
import { describe, expect, it } from 'vitest';
import { EDITOR_NODES, normalFormOf, prepareMarkdown, reconcile } from '../src/editor/convert';
import { $createMermaidNode, $isMermaidNode, MermaidNode } from '../src/editor/MermaidNode';

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

describe('mermaid fences', () => {
  it('normalFormOf is idempotent on a clean mermaid fence', () => {
    const source = '```mermaid\nflowchart LR\n  A --> B\n```';
    expect(normalFormOf(source)).toBe(source);
  });

  it('reconciles a clean mermaid fence byte-identically', () => {
    const source = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a 4-backtick mermaid-lang fence byte-identically', () => {
    const source = '````mermaid\nflowchart LR\n  A --> B\n````\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a heuristic empty-lang fence starting with flowchart LR byte-identically', () => {
    const source = '```\nflowchart LR\n  A --> B\n```\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a "text"-lang fence starting with graph TD byte-identically', () => {
    const source = '```text\ngraph TD\n  X --> Y\n```\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a mermaid fence whose body starts with a blank line (padding-quirk guard)', () => {
    const source = '```mermaid\n\nflowchart LR\n  A --> B\n```\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a mermaid fence sitting between two paragraphs byte-identically', () => {
    const source = 'Before paragraph.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter paragraph.\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('normalises a heuristic empty-lang fence to the explicit ```mermaid form', () => {
    const heuristic = '```\nflowchart LR\n  A --> B\n```';
    const explicit = '```mermaid\nflowchart LR\n  A --> B\n```';
    expect(normalFormOf(heuristic)).toBe(explicit);
  });

  it('leaves a js-lang fence with a mermaid-like body as code, not mermaid', () => {
    const normal = normalFormOf('```js\nflowchart LR\n  A --> B\n```');
    expect(normal.startsWith('```')).toBe(true);
    expect(normal.startsWith('```mermaid')).toBe(false);
  });

  it('leaves an empty-lang fence with plain prose as code, not mermaid', () => {
    const normal = normalFormOf('```\njust some prose\n```');
    expect(normal.startsWith('```')).toBe(true);
    expect(normal.startsWith('```mermaid')).toBe(false);
  });

  it('an edit to one mermaid fence leaves a sibling fence and a paragraph byte-identical', () => {
    const fenceA = '```mermaid\nflowchart LR\n  A --> B\n```';
    const fenceB = '```mermaid\nflowchart TD\n  X --> Y\n```';
    const source = `${fenceA}\n\nA paragraph.\n\n${fenceB}\n`;
    const editedFenceA = '```mermaid\nflowchart LR\n  A --> C\n```';
    const edited = `${editedFenceA}\n\nA paragraph.\n\n${fenceB}\n`;
    const result = reconcile(source, edited);
    expect(result).toContain(editedFenceA);
    expect(result).toContain(fenceB); // untouched sibling, original bytes
    expect(result).toContain('A paragraph.');
    expect(result).not.toContain(fenceA);
  });

  // A 4+-backtick opener must stay out of MERMAID's regExpStart entirely, so
  // fence-length-aware round-tripping stays with the built-in CODE
  // transformer. MERMAID's regExpEnd (any bare ```+ line) would otherwise
  // close the fence early at a bare ``` line inside the body, corrupting
  // legal CommonMark on a zero-edit save.
  it('reconciles a 4-backtick mermaid fence with a bare ``` line in its body byte-identically', () => {
    const source = '````mermaid\nflowchart LR\n```\nmore lines\n````\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a 4-backtick heuristic fence with a bare ``` line in its body byte-identically', () => {
    const source = '````\nflowchart LR\n  A --> B\n```\nsee the fence above\n````\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('reconciles a 4-backtick fence quoting an inner ```mermaid fence byte-identically', () => {
    const source = '````mermaid\nflowchart LR\n```mermaid\ninner\n```\n````\n';
    expect(reconcile(source, normalFormOf(source))).toBe(source);
  });

  it('keeps a bare ``` line mid-body inside the fence, with no early paragraph split', () => {
    const normal = normalFormOf('````mermaid\nflowchart LR\n```\nmore\n````');
    expect(normal).not.toMatch(/\n\nmore/);
    expect(reconcile('````mermaid\nflowchart LR\n```\nmore\n````\n', normalFormOf('````mermaid\nflowchart LR\n```\nmore\n````\n'))).toBe(
      '````mermaid\nflowchart LR\n```\nmore\n````\n',
    );
  });
});

describe('MermaidNode JSON round-trip', () => {
  it('preserves an arbitrary source string exactly through exportJSON/importJSON', () => {
    const editor = createHeadlessEditor({ nodes: EDITOR_NODES, onError: () => undefined });
    // Multi-line, with a leading and a trailing blank line.
    const source = '\nflowchart LR\n  A --> B\n\n';
    editor.update(
      () => {
        const node = $createMermaidNode(source);
        const json = node.exportJSON();
        expect(json).toEqual({ type: 'mermaid', version: 1, source });
        const restored = MermaidNode.importJSON(json);
        expect($isMermaidNode(restored)).toBe(true);
        expect(restored.getSource()).toBe(source);
      },
      { discrete: true },
    );
  });
});
