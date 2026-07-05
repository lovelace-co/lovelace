import { useState } from 'react';
import { DatePicker } from './DatePicker';
import { Dropdown } from './Dropdown';
import { HoleCheck } from './HoleCheck';
import { CloseIcon } from './icons';
import { titleCase } from '../lib/format';
import type { FieldDef, ProjectIndex, Workflow } from '../lib/types';
import { enumValuesFor } from '../lib/types';

interface FieldInputProps {
  def: FieldDef;
  value: unknown;
  workflow: Workflow;
  index: ProjectIndex;
  actors: Array<{ id: string; name: string }>;
  onChange: (value: unknown) => void;
}

/** Candidate IDs for a reference field, narrowed by refers_to. */
function referenceOptions(
  def: FieldDef,
  index: ProjectIndex,
  actors: Array<{ id: string; name: string }>,
): Array<{ id: string; label: string }> {
  const targets = def.refers_to;
  const out: Array<{ id: string; label: string }> = [];
  const wants = (kind: string) => !targets || targets.includes(kind);
  for (const t of index.tickets) {
    if (!targets || targets.includes(t.type)) out.push({ id: t.id, label: `${t.id} ${t.title}` });
  }
  if (wants('actor')) for (const a of actors) out.push({ id: a.id, label: `${a.id} (${a.name})` });
  if (wants('brief')) for (const b of index.briefs) out.push({ id: b.id, label: b.id });
  return out;
}

/**
 * One schema-driven input. The form is generated from workflow.yaml field
 * definitions: enum becomes a select, date a date picker, reference an
 * entity picker, list a tag input. Nothing here knows any field by name.
 */
export function FieldInput({ def, value, workflow, index, actors, onChange }: FieldInputProps) {
  const [draft, setDraft] = useState('');

  switch (def.type) {
    case 'boolean':
      return (
        <HoleCheck
          aria-label={def.name}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          className="form-input mono"
          type="number"
          aria-label={def.name}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <DatePicker
          aria-label={def.name}
          width="100%"
          value={typeof value === 'string' ? value.slice(0, 10) : null}
          onChange={(v) => onChange(v)}
        />
      );
    case 'enum': {
      const values = enumValuesFor(workflow, def);
      return (
        <Dropdown
          aria-label={def.name}
          width="100%"
          value={typeof value === 'string' ? value : ''}
          options={values.map((v) => ({ value: v, label: titleCase(v) }))}
          onChange={(v) => onChange(v || null)}
        />
      );
    }
    case 'reference': {
      const options = referenceOptions(def, index, actors);
      return (
        <Dropdown
          aria-label={def.name}
          width="100%"
          value={typeof value === 'string' ? value : ''}
          options={options.map((o) => ({ value: o.id, label: o.label }))}
          onChange={(v) => onChange(v || null)}
        />
      );
    }
    case 'list': {
      const items = Array.isArray(value) ? value.map(String) : [];
      const refOptions = def.item_type === 'reference' ? referenceOptions(def, index, actors) : null;
      const add = (item: string) => {
        const trimmed = item.trim();
        if (trimmed && !items.includes(trimmed)) onChange([...items, trimmed]);
        setDraft('');
      };
      return (
        <div className="field-list">
          {refOptions ? (
            <Dropdown
              aria-label={`add ${def.name}`}
              width="100%"
              value=""
              placeholder="add..."
              options={refOptions.filter((o) => !items.includes(o.id)).map((o) => ({ value: o.id, label: o.label }))}
              onChange={(v) => v && add(v)}
            />
          ) : (
            <input
              className="form-input mono"
              aria-label={`add ${def.name}`}
              placeholder="type and press enter"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add(draft);
              }}
            />
          )}
          {items.length > 0 && (
            <div className="field-chips">
              {items.map((item) => (
                <span key={item} className="field-chip">
                  {item}
                  <button
                    aria-label={`remove ${item}`}
                    className="field-chip-remove"
                    onClick={() => onChange(items.filter((x) => x !== item))}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    default:
      return (
        <input
          className="form-input"
          type="text"
          aria-label={def.name}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
