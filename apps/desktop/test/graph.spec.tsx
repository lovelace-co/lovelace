import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Graph } from '../src/views/Graph';
import type { GraphLayout, LinkEdge, Snapshot } from '../src/lib/types';

interface MiniDocument {
  id: string;
  summary: string;
  path: string;
}

function snap(documents: MiniDocument[], links: LinkEdge[], graphLayout?: GraphLayout): Snapshot {
  return {
    index: { documents, links, tickets: [], sessions: [], comments: [] },
    ...(graphLayout ? { graphLayout } : {}),
  } as unknown as Snapshot;
}

const DOCUMENTS: MiniDocument[] = [
  { id: 'context', summary: 'root', path: '.lovelace/documentation/index.md' },
  { id: 'architecture-overview', summary: 'arch', path: '.lovelace/documentation/architecture/OVERVIEW.md' },
  { id: 'domain-overview', summary: 'domain', path: '.lovelace/documentation/domain/OVERVIEW.md' },
];

const noop = () => undefined;

describe('Graph view', () => {
  it('renders one node per document and one edge per documentation link', () => {
    render(
      <Graph
        snapshot={snap(DOCUMENTS, [{ source: 'context', target: 'architecture-overview' }])}
        onOpenDocument={vi.fn()}
        onSaveLayout={noop}
      />,
    );
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('Architecture Overview')).toBeTruthy();
    expect(screen.getByText('Domain Overview')).toBeTruthy();
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(1);
  });

  it('excludes links that point at a ticket (documentation only)', () => {
    render(
      <Graph
        snapshot={snap(DOCUMENTS, [
          { source: 'context', target: 'architecture-overview' },
          { source: 'context', target: 'T-0001' },
        ])}
        onOpenDocument={vi.fn()}
        onSaveLayout={noop}
      />,
    );
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(1);
  });

  it('deep-links a clicked node by its path', () => {
    const onOpenDocument = vi.fn();
    render(
      <Graph
        snapshot={snap(DOCUMENTS, [{ source: 'context', target: 'architecture-overview' }])}
        onOpenDocument={onOpenDocument}
        onSaveLayout={noop}
      />,
    );
    const node = screen.getByText('Architecture Overview').closest('g');
    fireEvent.pointerDown(node!, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
    expect(onOpenDocument).toHaveBeenCalledWith('.lovelace/documentation/architecture/OVERVIEW.md');
  });

  it('places a saved (pinned) node at exactly its stored position', () => {
    render(
      <Graph
        snapshot={snap(DOCUMENTS, [], { context: { x: 220, y: 160 } })}
        onOpenDocument={vi.fn()}
        onSaveLayout={noop}
      />,
    );
    const circle = screen.getByText('Context').closest('g')!.querySelector('circle');
    expect(Number(circle!.getAttribute('cx'))).toBeCloseTo(220, 0);
    expect(Number(circle!.getAttribute('cy'))).toBeCloseTo(160, 0);
  });

  it('shows an empty state when there are no documents', () => {
    render(<Graph snapshot={snap([], [])} onOpenDocument={vi.fn()} onSaveLayout={noop} />);
    expect(screen.getByText('Nothing to graph yet')).toBeTruthy();
  });
});
