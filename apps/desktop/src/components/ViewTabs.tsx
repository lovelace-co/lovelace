import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Tab {
  key: string;
  label: string;
  /** Optional quiet trailing note (for example a field count), rendered in the app's count-note style. */
  note?: string;
  /** An optional trailing action (for example an edit pencil), shared with the tab's capsule but its own control. */
  action?: { label: string; icon: ReactNode; onClick: () => void };
}

interface ViewTabsProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}

/**
 * The app's tab bar: a row of seats under a view title. A single seat glides to
 * the active tab (state moves, never marks), the same gliding-seat language the
 * sidebar uses, so tabs and navigation feel like one system. The seat position
 * is measured, not hard-coded, so relabelling or adding a tab never desyncs it.
 * A tab may carry a trailing action (for example an edit pencil); since a
 * button cannot nest inside a button, that tab renders as two sibling controls
 * sharing one capsule, and the seat is measured from that outer wrapper so it
 * covers the action too.
 */
export function ViewTabs({ tabs, active, onChange, ariaLabel }: ViewTabsProps) {
  const refs = useRef(new Map<string, HTMLElement>());
  const [seat, setSeat] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current.get(active);
    if (!el) {
      setSeat(null);
      return;
    }
    setSeat({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, tabs]);

  return (
    <div className="view-tabs" role="tablist" aria-label={ariaLabel}>
      {seat && <span className="view-tabs-seat" style={{ left: seat.left, width: seat.width }} aria-hidden />}
      {tabs.map((t) =>
        t.action ? (
          <span
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el);
              else refs.current.delete(t.key);
            }}
            className="view-tab-group"
          >
            <button
              role="tab"
              aria-selected={active === t.key}
              aria-label={t.label}
              className={`view-tab${active === t.key ? ' active' : ''}`}
              onClick={() => onChange(t.key)}
            >
              {t.label}
              {t.note && <span className="count-note">{t.note}</span>}
            </button>
            <button
              type="button"
              className="view-tab-action"
              aria-label={t.action.label}
              onClick={t.action.onClick}
            >
              {t.action.icon}
            </button>
          </span>
        ) : (
          <button
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el);
              else refs.current.delete(t.key);
            }}
            role="tab"
            aria-selected={active === t.key}
            aria-label={t.label}
            className={`view-tab${active === t.key ? ' active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {t.note && <span className="count-note">{t.note}</span>}
          </button>
        ),
      )}
    </div>
  );
}
