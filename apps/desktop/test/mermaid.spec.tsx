import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../src/state/theme';
import { MermaidDiagram } from '../src/components/MermaidDiagram';
import { Markdown, isMermaidFence } from '../src/lib/markdown';

// Mock mermaid so tests do not need a full SVG engine in jsdom.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"><text>graph</text></svg>' }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('MermaidDiagram component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SVG output from mermaid on success', async () => {
    render(
      <Wrapper>
        <MermaidDiagram source="graph TD\n  A --> B" />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeTruthy());
  });

  it('shows "Rendering diagram..." while loading', async () => {
    // Make mermaid.render never resolve so we stay in loading state.
    const m = await import('mermaid');
    const mermaid = vi.mocked(m.default);
    mermaid.render.mockImplementation(() => new Promise(() => {}));

    render(
      <Wrapper>
        <MermaidDiagram source="graph TD\n  A --> B" />
      </Wrapper>,
    );
    expect(screen.getByText('Rendering diagram...')).toBeTruthy();
  });

  it('shows fallback source on render error without crashing', async () => {
    const m = await import('mermaid');
    const mermaid = vi.mocked(m.default);
    mermaid.render.mockRejectedValueOnce(new Error('syntax error'));

    render(
      <Wrapper>
        <MermaidDiagram source="invalid !!!" />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Diagram could not be rendered.')).toBeTruthy());
    expect(screen.getByText('invalid !!!')).toBeTruthy();
  });

  it('shows fallback source when error is not an Error instance', async () => {
    const m = await import('mermaid');
    const mermaid = vi.mocked(m.default);
    mermaid.render.mockRejectedValueOnce('bad');

    render(
      <Wrapper>
        <MermaidDiagram source="bad source" />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Diagram could not be rendered.')).toBeTruthy());
    expect(screen.getByText('bad source')).toBeTruthy();
  });
});

describe('Markdown mermaid fence integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes a mermaid fence to MermaidDiagram, not a <pre>', async () => {
    const source = '```mermaid\ngraph TD\n  A --> B\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    // The container gets class mermaid-diagram (MermaidDiagram renders it).
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
    // No raw <pre> for the mermaid block.
    const pres = document.querySelectorAll('pre');
    // Any <pre> present should not contain the mermaid source at root level.
    pres.forEach((pre) => {
      expect(pre.textContent).not.toContain('graph TD');
    });
  });

  it('routes a Mermaid fence (mixed case) to MermaidDiagram', async () => {
    const source = '```Mermaid\ngraph LR\n  X --> Y\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
  });

  it('leaves non-mermaid fences as <pre><code>', () => {
    const source = '```typescript\nconst x = 1;\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.querySelector('code')?.textContent).toBe('const x = 1;');
    expect(document.querySelector('.mermaid-diagram')).toBeNull();
  });

  it('routes an empty-lang fence with flowchart body to MermaidDiagram', async () => {
    const source = '```\nflowchart LR\n  A[Tickets] --> B[Docs]\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
    // The diagram source must not appear as a top-level <pre> text block.
    document.querySelectorAll('pre').forEach((pre) => {
      expect(pre.textContent).not.toContain('flowchart LR');
    });
  });

  it('routes a "text" lang fence with graph body to MermaidDiagram', async () => {
    const source = '```text\ngraph TD\n  X --> Y\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
  });

  it('leaves an empty-lang fence with non-mermaid body as <pre><code>', () => {
    const source = '```\njust some plain text\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(document.querySelector('.mermaid-diagram')).toBeNull();
  });
});

describe('isMermaidFence helper', () => {
  it('returns true for explicit mermaid lang', () => {
    expect(isMermaidFence('mermaid', 'flowchart LR\n  A --> B')).toBe(true);
  });

  it('returns true for mixed-case Mermaid lang', () => {
    expect(isMermaidFence('Mermaid', 'graph TD\n  A --> B')).toBe(true);
  });

  it('returns true for empty lang with flowchart body', () => {
    expect(isMermaidFence('', 'flowchart LR\n  A --> B')).toBe(true);
  });

  it('returns true for empty lang with sequenceDiagram body', () => {
    expect(isMermaidFence('', 'sequenceDiagram\n  Alice->>Bob: Hi')).toBe(true);
  });

  it('returns true for "text" lang with graph body', () => {
    expect(isMermaidFence('text', 'graph TD\n  A --> B')).toBe(true);
  });

  it('returns false for empty lang with non-mermaid body', () => {
    expect(isMermaidFence('', 'just some text')).toBe(false);
  });

  it('returns false for typescript lang', () => {
    expect(isMermaidFence('typescript', 'graph TD\n  A --> B')).toBe(false);
  });

  it('returns false for js lang even with mermaid-like body', () => {
    expect(isMermaidFence('js', 'flowchart LR\n  A --> B')).toBe(false);
  });
});

describe('Markdown fence close matching', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const m = await import('mermaid');
    vi.mocked(m.default).render.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg"><text>graph</text></svg>',
      diagramType: 'flowchart',
    });
  });

  it('a simple mermaid fence still routes to MermaidDiagram (regression)', async () => {
    const source = '```mermaid\nflowchart LR\n  A --> B\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
    // Flowchart text must not appear as a paragraph.
    document.querySelectorAll('p').forEach((p) => {
      expect(p.textContent).not.toContain('flowchart');
    });
  });

  it('outer 4-backtick + inner ```mermaid is collapsed and renders as MermaidDiagram', async () => {
    // collapseNestedMermaidFences rewrites this shell into a clean ```mermaid
    // fence before parsing, so it renders as MermaidDiagram rather than <pre>.
    const source = '````\n```mermaid\nflowchart LR\n  A --> B\n```\n````';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    // Flowchart text must NOT be in a paragraph (false-close symptom).
    document.querySelectorAll('p').forEach((p) => {
      expect(p.textContent).not.toContain('flowchart');
    });
    // The collapsed block renders as a MermaidDiagram, not a plain <pre>.
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
    // No <pre> should hold the flowchart text as raw content.
    document.querySelectorAll('pre').forEach((pre) => {
      expect(pre.textContent).not.toContain('flowchart');
    });
  });
});

describe('MermaidDiagram fence normalisation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore the success implementation after any prior test that may have
    // replaced it with a never-resolving or rejecting mock.
    const m = await import('mermaid');
    vi.mocked(m.default).render.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg"><text>graph</text></svg>',
      diagramType: 'flowchart',
    });
  });

  it('renders successfully when source contains accidental backtick fences', async () => {
    render(
      <Wrapper>
        <MermaidDiagram source={'```\nflowchart LR\n  A --> B\n```'} />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeTruthy());
  });

  it('renders successfully when source contains mermaid-labelled fences', async () => {
    render(
      <Wrapper>
        <MermaidDiagram source={'```mermaid\ngraph TD\n  A --> B\n```'} />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeTruthy());
  });
});

describe('Markdown nested mermaid fence collapse (real paste path)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const m = await import('mermaid');
    vi.mocked(m.default).render.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg" aria-label="mermaid diagram"><text>graph</text></svg>',
      diagramType: 'flowchart',
    });
  });

  it('renders a 4-backtick outer + ```mermaid inner as MermaidDiagram (not <pre>)', async () => {
    // This is the exact pattern Lexical produces when a mermaid fence is
    // re-exported: a longer outer fence wrapping the original ```mermaid block.
    const source = '````\n```mermaid\nflowchart LR\n  A --> B\n```\n````';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
    // flowchart must not appear in a paragraph or as a raw <pre> first line.
    document.querySelectorAll('p').forEach((p) => {
      expect(p.textContent).not.toContain('flowchart');
    });
    document.querySelectorAll('pre').forEach((pre) => {
      expect(pre.textContent).not.toMatch(/^```mermaid/);
    });
  });

  it('a non-mermaid outer fence (```js inside 4-ticks) still renders as <pre>', () => {
    const source = '````\n```js\nconst x = 1;\n```\n````';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    expect(document.querySelector('.mermaid-diagram')).toBeNull();
    expect(document.querySelector('pre')).toBeTruthy();
  });

  it('already-clean ```mermaid fence still renders correctly (idempotency)', async () => {
    const source = '```mermaid\nflowchart LR\n  A --> B\n```';
    render(
      <Wrapper>
        <Markdown source={source} />
      </Wrapper>,
    );
    await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeTruthy());
  });
});
