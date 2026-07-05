import { useEffect, useState } from 'react';
import { Dropdown } from '../components/Dropdown';
import { EmptyState } from '../components/EmptyState';
import { statusLabel } from '../lib/format';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';
import { legalTargets } from '../lib/types';

interface ActionsProps {
  snapshot: Snapshot;
}

/** The Runs view: the automation run history, plus a dry-run probe of what a move would fire. */
export function Actions({ snapshot }: ActionsProps) {
  const host = useHost();
  const [log, setLog] = useState('');
  const [dryTicket, setDryTicket] = useState('');
  const [dryStatus, setDryStatus] = useState('');
  const [dryResult, setDryResult] = useState<string | null>(null);

  useEffect(() => {
    void host.actionLog(snapshot.root).then(setLog, () => setLog(''));
  }, [host, snapshot]);

  const dryTargets = dryTicket
    ? [...legalTargets(snapshot.workflow, snapshot.index.tickets.find((t) => t.id === dryTicket)?.status ?? '')]
    : [];

  const statusName = (name: string): string => {
    const def = snapshot.workflow.statuses.find((s) => s.name === name);
    return def ? statusLabel(def) : name;
  };

  const runDry = async () => {
    if (!dryTicket || !dryStatus) return;
    const rules = await host.testTransition(snapshot.root, dryTicket, dryStatus);
    if (rules.length === 0) {
      setDryResult('No automations would fire.');
    } else {
      setDryResult(
        rules.map((r) => `${r.run !== undefined ? 'run' : 'agent'}: ${r.run ?? r.agent}`).join('\n'),
      );
    }
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Runs</h1>
        <span className="subtle">what your automations would and did do</span>
      </header>
      <div className="view-body" style={{ display: 'grid', gap: '1.6rem' }}>
        <section>
          <h2 className="section-heading">Dry run</h2>
          <p className="subtle" style={{ marginBottom: 14, maxWidth: '58ch' }}>
            See which automations a move would fire, without running them.
          </p>
          <div className="panel" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Dropdown
                aria-label="dry run ticket"
                value={dryTicket}
                placeholder="choose a ticket"
                options={snapshot.index.tickets.map((t) => ({ value: t.id, label: `${t.id} ${t.title}` }))}
                onChange={(v) => {
                  setDryTicket(v);
                  setDryStatus('');
                  setDryResult(null);
                }}
              />
              <Dropdown
                aria-label="dry run status"
                value={dryStatus}
                placeholder="target status"
                disabled={!dryTicket}
                options={dryTargets.map((s) => ({ value: s, label: statusName(s) }))}
                onChange={setDryStatus}
              />
              <button className="btn btn-secondary" disabled={!dryTicket || !dryStatus} onClick={() => void runDry()}>
                What would fire?
              </button>
            </div>
            {dryResult !== null && <pre className="digest-pre" style={{ padding: '0.6rem 0 0' }}>{dryResult}</pre>}
          </div>
        </section>

        <section>
          <h2 className="section-heading">History</h2>
          <div className="panel">
            {log.trim() === '' ? (
              <EmptyState compact note="No automations have run yet." />
            ) : (
              <pre className="digest-pre">{log}</pre>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
