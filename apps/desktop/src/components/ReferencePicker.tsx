import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceCandidate } from '../lib/links';

interface ReferencePickerProps {
  title: string;
  /** Candidates already narrowed to one kind (tickets, documents or files). */
  candidates: ReferenceCandidate[];
  onPick: (token: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 60;

/**
 * A focused search-and-pick modal for inserting one reference of a kind, opened
 * by the toolbar buttons. Fuzzy (substring) filter over label, token and hint,
 * with arrow/enter/escape keys.
 */
export function ReferencePicker({ title, candidates, onPick, onClose }: ReferencePickerProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches =
      q === ''
        ? candidates
        : candidates.filter(
            (c) =>
              c.label.toLowerCase().includes(q) ||
              c.token.toLowerCase().includes(q) ||
              c.hint.toLowerCase().includes(q),
          );
    return matches.slice(0, MAX_RESULTS);
  }, [candidates, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ref-picker" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <input
          ref={inputRef}
          className="form-input"
          aria-label="search references"
          placeholder="Type to search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(results.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const c = results[highlight];
              if (c) onPick(c.token);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="ref-picker-list" role="listbox" aria-label={title}>
          {results.length === 0 && <li className="ref-picker-empty">No matches</li>}
          {results.map((c, i) => (
            <li
              key={c.token}
              role="option"
              aria-selected={i === highlight}
              className={`ref-item${i === highlight ? ' selected' : ''}`}
              onPointerEnter={() => setHighlight(i)}
              onPointerDown={(e) => {
                e.preventDefault();
                onPick(c.token);
              }}
            >
              <span className="ref-item-label">{c.label}</span>
              <span className="ref-item-hint">{c.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
