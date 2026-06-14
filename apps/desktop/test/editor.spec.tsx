import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical';
import { BlockEditor } from '../src/editor/BlockEditor';
import { editBlock, parseBlocks, serialiseBlocks } from '../src/editor/blocks';

const FIXTURE = resolve(__dirname, '../../../examples/demo-project/.lovelace');

function allMarkdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allMarkdownFiles(full, acc);
    else if (entry.endsWith('.md')) acc.push(full);
  }
  return acc;
}

function bodyOf(content: string): string {
  const parts = content.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').replace(/^\n/, '') : content;
}

describe('round-trip fidelity (the acceptance bar)', () => {
  it('parse then serialise is byte-identical for every body in the demo project', () => {
    const files = allMarkdownFiles(FIXTURE);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const body = bodyOf(readFileSync(file, 'utf8'));
      const roundTripped = serialiseBlocks(parseBlocks(body));
      expect(roundTripped, `round-trip mismatch in ${file}`).toBe(body);
    }
  });

  it('survives hostile constructs: nested fences, trailing whitespace, no trailing newline, tabs', () => {
    const samples = [
      'no trailing newline',
      'trailing spaces   \nand more  \n',
      '```js\nconst x = 1;\n\nconst y = 2;\n```\n',
      '~~~\nfenced with tildes\n~~~\n',
      '- list\n  - nested\n    continued line\n- back\n',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      '> quote\n> more\n\nplain\n',
      '<div class="x">\nhtml block\n</div>\n\nafter\n',
      '\n\n\nleading blanks\n\n\n',
      '# h\n## h2\nimmediately after\n',
      'Setext-ish\n===\n',
    ];
    for (const sample of samples) {
      expect(serialiseBlocks(parseBlocks(sample))).toBe(sample);
    }
  });

  it('an edit produces a minimal diff: only the edited block changes', () => {
    const body = bodyOf(readFileSync(join(FIXTURE, 'tickets/T-0002.md'), 'utf8'));
    const blocks = parseBlocks(body);
    const paragraphIndex = blocks.findIndex((b) => b.kind === 'paragraph');
    const next = serialiseBlocks(editBlock(blocks, paragraphIndex, 'Rewritten paragraph.'));
    const beforeLines = body.split('\n');
    const afterLines = next.split('\n');
    const changed = afterLines.filter((l) => !beforeLines.includes(l));
    expect(changed).toEqual(['Rewritten paragraph.']);
    // Everything after the edited block is untouched, including list markers.
    expect(next).toContain('- [ ] Endpoint serves from cache only; no inline upstream calls.');
  });

  it('classifies unsupported constructs as raw and keeps them verbatim', () => {
    const body = 'before\n\n<aside data-x="1">\ncustom html\n</aside>\n\nafter\n';
    const blocks = parseBlocks(body);
    const raw = blocks.find((b) => b.kind === 'raw');
    expect(raw?.source).toBe('<aside data-x="1">\ncustom html\n</aside>');
    expect(serialiseBlocks(blocks)).toBe(body);
  });
});

describe('BlockEditor component (Lexical)', () => {
  function renderEditor(source: string, onChange = vi.fn()) {
    let editor: LexicalEditor | null = null;
    render(<BlockEditor source={source} onChange={onChange} onReady={(e) => (editor = e)} />);
    return { onChange, editor: () => editor! };
  }

  it('renders markdown formatted, never as source', () => {
    renderEditor('# Title\n\nSome **bold** text.\n');
    expect(screen.getByText('Title').closest('h1')).not.toBeNull();
    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
    expect(document.body.textContent).not.toContain('**');
  });

  it('shows a formatting toolbar', () => {
    renderEditor('hello\n');
    expect(screen.getByRole('toolbar')).toBeTruthy();
    expect(screen.getByLabelText('bold')).toBeTruthy();
    expect(screen.getByLabelText('block type')).toBeTruthy();
  });

  it('read-only mode renders formatted without an editable surface or toolbar', () => {
    render(<BlockEditor source={'A paragraph.\n'} onChange={vi.fn()} readOnly />);
    expect(screen.getByText('A paragraph.')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.querySelector('.lexical-content')?.getAttribute('contenteditable')).toBe('false');
  });

  it('task items render as punch holes with their checked state', () => {
    renderEditor('- [ ] open task\n- [x] done task\n');
    expect(document.querySelector('.le-li-unchecked')).not.toBeNull();
    expect(document.querySelector('.le-li-checked')).not.toBeNull();
  });

  it('keeps tables and raw blocks verbatim through the editor', () => {
    renderEditor('before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n');
    const verbatim = document.querySelector('.block-raw-pre');
    expect(verbatim?.textContent).toContain('| a | b |');
  });

  it('an edit emits only the edited block changed; untouched bytes survive', async () => {
    const source = '* odd  bullet\n\nOld text.\n';
    const { onChange, editor } = renderEditor(source);
    await act(async () => {
      editor().update(() => {
        const root = $getRoot();
        const para = $createParagraphNode();
        para.append($createTextNode('Appended line.'));
        root.append(para);
      });
    });
    await act(async () => {
      document.querySelector('.lexical-content')?.dispatchEvent(new FocusEvent('blur'));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as string;
    // The untouched asterisk-marker bullet keeps its exact bytes.
    expect(next).toContain('* odd  bullet');
    expect(next).toContain('Old text.');
    expect(next).toContain('Appended line.');
  });
});
