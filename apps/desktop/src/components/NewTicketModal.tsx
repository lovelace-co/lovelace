import { useMemo, useState } from 'react';
import type { Snapshot } from '../lib/types';
import { fieldsFor } from '../lib/types';
import { fieldLabel, statusLabel, typeLabel } from '../lib/format';
import { Dropdown } from './Dropdown';
import { Toast } from './Toast';
import { FieldInput } from './FieldInput';

interface NewTicketModalProps {
  snapshot: Snapshot;
  /** Column the ticket starts in; defaults to the workflow's first status. */
  initialStatus?: string;
  onClose: () => void;
  onCreate: (type: string, fields: Record<string, unknown>, status?: string) => Promise<void>;
}

export function NewTicketModal({ snapshot, initialStatus, onClose, onCreate }: NewTicketModalProps) {
  const [type, setType] = useState(snapshot.workflow.types.find((t) => t.name !== 'epic')?.name ?? snapshot.workflow.types[0]?.name ?? 'task');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defs = useMemo(() => fieldsFor(snapshot.fieldCatalogue, type), [snapshot.fieldCatalogue, type]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== ''),
      );
      await onCreate(type, clean, initialStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New ticket</h2>
        {initialStatus !== undefined && (
          <div className="field-row">
            <span className="label">column</span>
            <span className="id-chip">{statusLabel(snapshot.workflow.statuses.find((st) => st.name === initialStatus) ?? { name: initialStatus })}</span>
          </div>
        )}
        <div className="field-row">
          <span className="label">type</span>
          <Dropdown
            aria-label="ticket type"
            width="100%"
            value={type}
            options={snapshot.workflow.types.map((t) => ({ value: t.name, label: typeLabel(t) }))}
            onChange={(v) => {
              if (!v) return;
              setType(v);
              setFields({});
            }}
          />
        </div>
        {defs.map((def) => (
          <div className="field-row" key={def.name}>
            <span className="label">
              {fieldLabel(def)}
              {def.required ? ' *' : ''}
            </span>
            <FieldInput
              def={def}
              value={fields[def.name]}
              workflow={snapshot.workflow}
              index={snapshot.index}
              actors={snapshot.actors}
              onChange={(value) => setFields((f) => ({ ...f, [def.name]: value }))}
            />
          </div>
        ))}
        {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating...' : 'Create ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
