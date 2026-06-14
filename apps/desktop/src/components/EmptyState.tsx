import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** The primary line, e.g. "No sessions yet". */
  note: string;
  /** An optional second line of guidance; may contain mono for paths. */
  hint?: ReactNode;
  /** Left-aligned and tighter, for an empty section inside a populated page. */
  compact?: boolean;
}

/**
 * The shared empty state: a quiet note with optional guidance, so every empty
 * region across the app reads the same. Page-level empties centre it; a section
 * inside a page passes `compact`.
 */
export function EmptyState({ note, hint, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      <span className="empty-note">{note}</span>
      {hint !== undefined && <span className="empty-hint">{hint}</span>}
    </div>
  );
}
