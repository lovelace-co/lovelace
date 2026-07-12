import { useEffect } from 'react';
import { CloseIcon } from './icons';
import { EmptyState } from './EmptyState';
import type { Issue } from '../lib/types';

interface ProblemsModalProps {
  issues: Issue[];
  onClose: () => void;
}

/** Every validation issue across the project, in a modal. */
export function ProblemsModal({ issues, onClose }: ProblemsModalProps) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell">
        <button className="modal-close" aria-label="Close problems" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="records-card" role="dialog" aria-label="problems" onClick={(e) => e.stopPropagation()}>
          <div className="info-card-head">
            <div className="info-card-titles">
              <h2 className="info-card-name">Problems</h2>
              <span className="info-card-sub">
                {errors.length} errors, {warnings.length} warnings
              </span>
            </div>
          </div>
          <div className="records-well">
            {issues.length === 0 && (
              <EmptyState note="Everything validates" hint="No errors or warnings across the project." />
            )}
            {issues.map((issue, i) => (
              <div key={i} className="issue-row">
                <span className={`sev-${issue.severity}`}>{issue.severity}</span>
                <span className="mono" style={{ color: 'var(--slate)' }}>
                  {issue.file}
                  {issue.line !== undefined ? `:${issue.line}` : ''}
                </span>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
