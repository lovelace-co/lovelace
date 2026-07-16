import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { $getRoot, type LexicalEditor } from 'lexical';
import { BlockEditor } from '../src/editor/BlockEditor';
import { insertMermaid } from '../src/editor/MermaidNode';
import { MermaidEditModal } from '../src/components/MermaidEditModal';

// Mock mermaid so tests do not need a full SVG engine in jsdom (matches
// test/mermaid.spec.tsx:8-13).
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"><text>graph</text></svg>' }),
  },
}));

function renderEditor(source: string, onChange = vi.fn()) {
  let editor: LexicalEditor | null = null;
  render(<BlockEditor source={source} onChange={onChange} onReady={(e) => (editor = e)} />);
  return { onChange, editor: () => editor! };
}

const FLOWCHART = '```mermaid\nflowchart LR\n  A --> B\n```\n';

describe('mermaid blocks in the editor', () => {
  it('a mermaid fence renders as a mermaid block, not a code block', async () => {
    renderEditor(FLOWCHART);
    await waitFor(() => expect(document.querySelector('.mermaid-block')).toBeTruthy());
    expect(document.querySelector('.le-code')).toBeNull();
  });

  it('Edit diagram opens the modal with the block source; Cancel leaves the document unchanged', async () => {
    const { onChange } = renderEditor(FLOWCHART);
    await waitFor(() => expect(document.querySelector('.mermaid-block')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit diagram' }));
    const textarea = screen.getByLabelText('diagram source') as HTMLTextAreaElement;
    expect(textarea.value).toBe('flowchart LR\n  A --> B');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.mermaid-block')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Save updates the node; the exported markdown carries the new source and an untouched sibling paragraph survives', async () => {
    const source = `${FLOWCHART}\nUntouched paragraph.\n`;
    const { onChange } = renderEditor(source);
    await waitFor(() => expect(document.querySelector('.mermaid-block')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit diagram' }));
    const textarea = screen.getByLabelText('diagram source') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'flowchart LR\n  A --> C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      document.querySelector('.lexical-content')?.dispatchEvent(new FocusEvent('blur'));
    });

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
    expect(next).toContain('A --> C');
    expect(next).toContain('Untouched paragraph.');
  });

  it('Escape closes the modal as Cancel; backdrop click does the same', async () => {
    renderEditor(FLOWCHART);
    await waitFor(() => expect(document.querySelector('.mermaid-block')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit diagram' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit diagram' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(document.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('insertMermaid opens the modal in "new" mode with a template chooser; Cancel removes the inserted node', async () => {
    const { editor } = renderEditor('Existing paragraph.\n');
    // A selection must exist for the insertion to land (see editor.spec.tsx).
    await act(async () => {
      editor().update(() => $getRoot().selectEnd());
    });
    await act(async () => {
      insertMermaid(editor());
    });

    expect(screen.getByRole('heading', { name: 'New diagram' })).toBeTruthy();
    expect(screen.getByLabelText('diagram template')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.mermaid-block')).toBeNull();
  });

  it('insertMermaid then Save keeps the node; the export contains a mermaid fence', async () => {
    const { onChange, editor } = renderEditor('Existing paragraph.\n');
    await act(async () => {
      editor().update(() => $getRoot().selectEnd());
    });
    await act(async () => {
      insertMermaid(editor());
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await act(async () => {
      document.querySelector('.lexical-content')?.dispatchEvent(new FocusEvent('blur'));
    });

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
    expect(next).toContain('```mermaid');
    expect(next).toContain('Existing paragraph.');
  });

  it('read-only editor renders the diagram without an edit affordance', async () => {
    render(<BlockEditor source={FLOWCHART} onChange={vi.fn()} readOnly />);
    await waitFor(() => expect(document.querySelector('.mermaid-block')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Edit diagram' })).toBeNull();
  });
});

describe('MermaidEditModal', () => {
  it('debounces the live preview render for ~300ms after an edit', async () => {
    const m = await import('mermaid');
    const mermaid = vi.mocked(m.default);
    vi.useFakeTimers();
    try {
      render(
        <MermaidEditModal
          initialSource="flowchart LR\n  A --> B"
          isNew={false}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      // Let the initial mount's debounce settle before measuring the edit.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      mermaid.render.mockClear();

      const textarea = screen.getByLabelText('diagram source') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'flowchart LR\n  A --> C' } });

      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(mermaid.render).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      expect(mermaid.render).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the template chooser replaces the draft, and only appears in new mode', () => {
    render(
      <MermaidEditModal initialSource="flowchart LR\n  A --> B" isNew onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText('diagram template'));
    fireEvent.click(screen.getByRole('option', { name: 'Sequence' }));
    const textarea = screen.getByLabelText('diagram source') as HTMLTextAreaElement;
    expect(textarea.value).toBe('sequenceDiagram\n  Alice->>Bob: Hello');
  });

  it('does not show a template chooser when editing an existing diagram', () => {
    render(
      <MermaidEditModal initialSource="flowchart LR\n  A --> B" isNew={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByLabelText('diagram template')).toBeNull();
  });

  it('disables Save when the draft is blank', () => {
    render(
      <MermaidEditModal initialSource="flowchart LR\n  A --> B" isNew={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const textarea = screen.getByLabelText('diagram source') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
