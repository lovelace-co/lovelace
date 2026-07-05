import { useLayoutEffect, useRef, useState } from 'react';

interface Tab {
  key: string;
  label: string;
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
 */
export function ViewTabs({ tabs, active, onChange, ariaLabel }: ViewTabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
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
      {tabs.map((t) => (
        <button
          key={t.key}
          ref={(el) => {
            if (el) refs.current.set(t.key, el);
            else refs.current.delete(t.key);
          }}
          role="tab"
          aria-selected={active === t.key}
          className={`view-tab${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
