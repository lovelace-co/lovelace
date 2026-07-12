import { useEffect, useRef, useState } from 'react';
import { useHost } from '../state/store';
import { searchShortcutLabel } from '../lib/platform';
import type { SearchHit } from '../lib/types';

interface SearchPaletteProps {
  root: string;
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
}

/**
 * The project's text search as a command palette: one input, results from
 * the core search tool (the same one the agent uses), keyboard-driven.
 * Opens on the sidebar Search item or Cmd/Ctrl+K.
 */
export function SearchPalette({ root, onPick, onClose }: SearchPaletteProps) {
  const host = useHost();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce so each keystroke does not spawn a search; empty clears.
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void host.search(root, q).then(
        (results) => {
          setHits(results);
          setHighlight(0);
          setSearching(false);
        },
        () => {
          setHits([]);
          setSearching(false);
        },
      );
    }, 140);
    return () => clearTimeout(timer);
  }, [host, root, query]);

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onPick(hit);
    onClose();
  };

  // Documents are surfaced to the user as "documentation".
  const kindLabel = (kind: string) => (kind === 'document' ? 'documentation' : kind);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="search"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          aria-label="search query"
          placeholder="Search tickets, documentation, sessions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(hits[highlight]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette-results">
          {query.trim() !== '' && !searching && hits.length === 0 && (
            <p className="subtle" style={{ padding: '0.7rem 0.9rem' }}>
              No matches.
            </p>
          )}
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}:${hit.id}:${hit.path}`}
              className={`palette-hit${i === highlight ? ' active' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => choose(hit)}
            >
              <span className="palette-kind">{kindLabel(hit.kind)}</span>
              <span className="palette-id">{hit.id}</span>
              <span className="palette-snippet">{hit.snippet}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span>&uarr;&darr; to move</span>
          <span>&crarr; to open</span>
          <span>esc to close</span>
          <span>{searchShortcutLabel} opens this search</span>
        </div>
      </div>
    </div>
  );
}
