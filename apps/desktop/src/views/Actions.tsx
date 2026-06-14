import { useEffect, useState } from 'react';
import { Dropdown } from '../components/Dropdown';
import { EmptyState } from '../components/EmptyState';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';
import { legalTargets } from '../lib/types';

interface ActionsProps {
  snapshot: Snapshot;
  /** When hosted inside another view (Automations), the host owns the header. */
  embedded?: boolean;
}

/** The automation run history, plus a dry-run probe of what a move would fire. */
export function Actions({ snapshot, embedded = false }: ActionsProps) {
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
      {!embedded && (
        <header className="view-header">
          <h1 className="view-title">Activity</h1>
          <span className="subtle">what your automations would and did do</span>
        </header>
      )}
      <div
        className={embedded ? undefined : 'view-body'}
        style={{ ...(embedded ? { padding: '0.4rem 0 0' } : {}), display: 'grid', gap: '1rem' }}
      >
        <section className="glass-card" style={{ padding: '0.8rem 0.9rem' }}>
          <h2 className="label" style={{ margin: '0 0 0.5rem' }}>
            Dry run
          </h2>
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
              options={dryTargets.map((s) => ({ value: s, label: s }))}
              onChange={setDryStatus}
            />
            <button className="btn btn-secondary" disabled={!dryTicket || !dryStatus} onClick={() => void runDry()}>
              What would fire?
            </button>
          </div>
          {dryResult !== null && <pre className="digest-pre" style={{ padding: '0.6rem 0 0' }}>{dryResult}</pre>}
        </section>

        <section className="glass-card">
          <h2 className="label" style={{ padding: '0.8rem 0.9rem 0.2rem', margin: 0 }}>
            History
          </h2>
          {log.trim() === '' ? (
            <EmptyState compact note="No automations have run yet." />
          ) : (
            <pre className="digest-pre">{log}</pre>
          )}
        </section>
      </div>
    </>
  );
}
