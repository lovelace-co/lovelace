import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../state/theme';

let counter = 0;

function nextId(): string {
  counter += 1;
  return `mermaid-${counter}`;
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

/**
 * Strip outer Markdown fences if the source was accidentally passed with them
 * (e.g. ``` or ~~~, with an optional `mermaid` lang tag on the opening line).
 * Mermaid's parser needs raw diagram syntax, not a fenced block.
 */
function normalizeMermaid(source: string): string {
  // Also undo Lexical's \`\`\` escaping if it leaked into the body.
  let trimmed = source.trim().replace(/(^|\n)(?:\\`){3}([\w-]*)[ \t]*(?=\n|$)/g, '$1```$2');
  const fenceMatch = /^(`{3,}|~{3,})(mermaid)?\s*\n([\s\S]*?)\n(`{3,}|~{3,})\s*$/.exec(trimmed);
  if (fenceMatch) {
    return (fenceMatch[3] ?? '').trim();
  }
  return trimmed;
}

let mermaidPromise: Promise<MermaidApi> | null = null;
let lastTheme: 'dark' | 'light' | null = null;

async function getMermaid(theme: 'dark' | 'light'): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default as MermaidApi);
  }
  const mermaid = await mermaidPromise;
  if (lastTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      // Local Markdown only; keep click handlers out of rendered SVG.
      securityLevel: 'strict',
    });
    lastTheme = theme;
  }
  return mermaid;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; svg: string }
  | { kind: 'error' };

export function MermaidDiagram({ source }: { source: string }) {
  const { theme } = useTheme();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const idRef = useRef(nextId());

  useEffect(() => {
    let cancelled = false;
    const id = idRef.current;

    async function render() {
      setState({ kind: 'loading' });
      try {
        const mermaid = await getMermaid(theme);
        const text = normalizeMermaid(source);
        const { svg } = await mermaid.render(id, text);
        if (!cancelled) setState({ kind: 'ok', svg });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    }

    void render();
    return () => {
      cancelled = true;
      // Mermaid caches by id; take a fresh one after unmount or theme churn.
      idRef.current = nextId();
    };
  }, [source, theme]);

  if (state.kind === 'error') {
    return (
      <div className="mermaid-diagram mermaid-diagram--error">
        <p className="mermaid-diagram__error-msg">Diagram could not be rendered.</p>
        <pre className="mermaid-diagram__source">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className="mermaid-diagram mermaid-diagram--loading" aria-label="mermaid diagram">
        <span className="mermaid-diagram__loading">Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram"
      aria-label="mermaid diagram"
      // SVG comes from the local mermaid renderer, never from raw user HTML.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
