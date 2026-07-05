import { Dropdown } from './Dropdown';
import { formatDate } from '../lib/datetime';
import { DEFAULT_PRESENCE_TIMEOUT_MINUTES } from '../lib/presence';
import type { Snapshot } from '../lib/types';

interface GeneralSettingsProps {
  snapshot: Snapshot;
  /** Rename the project (saved on blur, like a document summary). */
  onRename: (name: string) => Promise<void>;
  /** Persist the presence stale cap in minutes; null returns to the default. */
  onSavePresenceTimeout: (minutes: number | null) => Promise<void>;
}

/* The stale cap choices; the default stays out of the file so manifests
   remain clean until a project actually opts into a different window. */
const PRESENCE_CHOICES = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: DEFAULT_PRESENCE_TIMEOUT_MINUTES, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
];

/**
 * The General settings section: the editable project name, and the
 * tooling-managed facts (id, path, spec version, creation date) shown
 * read-only.
 */
export function GeneralSettings({ snapshot, onRename, onSavePresenceTimeout }: GeneralSettingsProps) {
  const m = snapshot.manifest;
  const homePath = snapshot.root.replace(/^\/Users\/[^/]+/, '~');
  const timeout = m.presence_timeout_minutes ?? DEFAULT_PRESENCE_TIMEOUT_MINUTES;
  const timeoutChoices = PRESENCE_CHOICES.some((c) => c.minutes === timeout)
    ? PRESENCE_CHOICES
    : [...PRESENCE_CHOICES, { minutes: timeout, label: `${timeout} minutes` }].sort((a, b) => a.minutes - b.minutes);

  return (
    <div className="settings-section">
      <div className="field-row">
        <span className="label">Project name</span>
        <input
          key={m.name}
          className="form-input"
          aria-label="project name"
          defaultValue={m.name}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (!next || next === m.name) {
              e.target.value = m.name;
              return;
            }
            void onRename(next);
          }}
        />
      </div>

      <div className="field-row">
        <span className="label">Agent presence</span>
        <div>
          <Dropdown
            aria-label="show a working agent as gone after"
            width="12rem"
            value={String(timeout)}
            options={timeoutChoices.map((c) => ({ value: String(c.minutes), label: c.label }))}
            onChange={(v) => {
              const minutes = Number(v);
              if (!Number.isInteger(minutes) || minutes <= 0 || minutes === timeout) return;
              void onSavePresenceTimeout(minutes === DEFAULT_PRESENCE_TIMEOUT_MINUTES ? null : minutes);
            }}
          />
          <p className="subtle" style={{ marginTop: 8 }}>
            A working agent whose session ends without saying so is shown as gone after this long. Raise it for
            long-running work.
          </p>
        </div>
      </div>

      <dl className="info-grid" style={{ marginTop: 22 }}>
        <dt>Project ID</dt>
        <dd className="mono">{m.project_id}</dd>

        <dt>Location</dt>
        <dd className="mono">{homePath}</dd>

        <dt>Spec version</dt>
        <dd>{m.spec_version}</dd>

        <dt>Created</dt>
        <dd>{formatDate(m.created)}</dd>
      </dl>
      <p className="subtle" style={{ marginTop: 14 }}>
        The ID, location and spec version are managed by the tooling and cannot be changed here.
      </p>
    </div>
  );
}
