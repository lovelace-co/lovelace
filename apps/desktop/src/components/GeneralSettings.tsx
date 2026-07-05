import { formatDate } from '../lib/datetime';
import type { Snapshot } from '../lib/types';

interface GeneralSettingsProps {
  snapshot: Snapshot;
  /** Rename the project (saved on blur, like a document summary). */
  onRename: (name: string) => Promise<void>;
}

/**
 * The General settings section: the editable project name, and the
 * tooling-managed facts (id, path, spec version, creation date) shown
 * read-only.
 */
export function GeneralSettings({ snapshot, onRename }: GeneralSettingsProps) {
  const m = snapshot.manifest;
  const homePath = snapshot.root.replace(/^\/Users\/[^/]+/, '~');

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
