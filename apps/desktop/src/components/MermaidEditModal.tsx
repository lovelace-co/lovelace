import { useEffect, useState } from 'react';
import { Dropdown, type DropdownOption } from './Dropdown';
import { MermaidDiagram } from './MermaidDiagram';

interface MermaidEditModalProps {
  initialSource: string;
  isNew: boolean;
  onSave: (source: string) => void;
  onCancel: () => void;
}

/**
 * Starter diagrams for the "new diagram" template chooser. Duplicated from
 * MermaidNode's MERMAID_STARTER_TEMPLATE rather than imported, so this
 * (deliberately Lexical-free) file does not pull the Lexical import graph in.
 */
const TEMPLATES: Record<string, string> = {
  flowchart: 'flowchart LR\n  A[Start] --> B[Finish]',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello',
  class: 'classDiagram\n  class Animal',
  state: 'stateDiagram-v2\n  [*] --> Idle',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
};

const TEMPLATE_OPTIONS: DropdownOption[] = [
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'sequence', label: 'Sequence' },
  { value: 'class', label: 'Class' },
  { value: 'state', label: 'State' },
  { value: 'er', label: 'Entity relationship' },
];

/**
 * The source editor for a mermaid block: a source/preview split with a live,
 * debounced render (mermaid's own error state doubles as syntax feedback).
 * New diagrams get a template chooser; editing an existing one does not.
 */
export function MermaidEditModal({ initialSource, isNew, onSave, onCancel }: MermaidEditModalProps) {
  const [draft, setDraft] = useState(initialSource);
  const [preview, setPreview] = useState(initialSource);
  const [template, setTemplate] = useState('flowchart');

  useEffect(() => {
    const timer = setTimeout(() => setPreview(draft), 300);
    return () => clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="mermaid-modal" role="dialog" aria-label={isNew ? 'New diagram' : 'Edit diagram'} onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'New diagram' : 'Edit diagram'}</h2>
        {isNew && (
          <div className="field-row">
            <span className="label">template</span>
            <Dropdown
              aria-label="diagram template"
              width="100%"
              value={template}
              options={TEMPLATE_OPTIONS}
              allowEmpty={false}
              onChange={(v) => {
                if (!v) return;
                setTemplate(v);
                setDraft(TEMPLATES[v] ?? '');
              }}
            />
          </div>
        )}
        <div className="mermaid-modal-body">
          <textarea
            className="mermaid-modal-source mono"
            aria-label="diagram source"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="mermaid-modal-preview">
            <MermaidDiagram source={preview} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={draft.trim() === ''} onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
