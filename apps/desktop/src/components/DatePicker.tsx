import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CalendarIcon, CaretIcon } from './icons';
import { formatDate } from '../lib/datetime';

interface DatePickerProps {
  /** ISO date (yyyy-mm-dd) or null for no date. */
  value: string | null;
  onChange: (value: string | null) => void;
  'aria-label': string;
  placeholder?: string;
  disabled?: boolean;
  /** Explicit trigger width (for form contexts, '100%'). */
  width?: number | string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

function parseIso(value: string | null): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** First day of the week for the OS locale: 0 Sunday .. 6 Saturday. */
function firstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language);
    const info =
      (locale as { getWeekInfo?: () => { firstDay: number } }).getWeekInfo?.() ??
      (locale as unknown as { weekInfo?: { firstDay: number } }).weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    /* older runtimes fall back below */
  }
  return 1;
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

/**
 * The app's datepicker: a quiet trigger showing the locale-formatted date
 * and a floating calendar on the inverted panel palette (native pickers
 * cannot be styled). Click or Enter opens; arrows move a day, month
 * chevrons a month; Enter picks; Escape and outside clicks close.
 */
export function DatePicker({
  value,
  onChange,
  'aria-label': ariaLabel,
  placeholder = 'No date',
  disabled = false,
  width,
}: DatePickerProps) {
  const now = new Date();
  const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const selected = parseIso(value);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [focusDay, setFocusDay] = useState(1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wantFocus = useRef(false);
  const [position, setPosition] = useState<CSSProperties>({});

  const openPanel = () => {
    const start = selected ?? parseIso(todayIso)!;
    setView({ year: start.year, month: start.month });
    setFocusDay(start.day);
    wantFocus.current = true;
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const openUp = below < 360 && rect.top > below;
      setPosition({
        left: Math.min(rect.left, window.innerWidth - 336),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    }
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard moves land focus on the day after the grid re-renders.
  useEffect(() => {
    if (open && wantFocus.current) {
      dayRefs.current[focusDay]?.focus();
      wantFocus.current = false;
    }
  });

  const shiftMonth = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setFocusDay((f) => Math.min(f, daysIn(d.getFullYear(), d.getMonth())));
  };

  const moveFocus = (delta: number) => {
    const d = new Date(view.year, view.month, focusDay + delta);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setFocusDay(d.getDate());
    wantFocus.current = true;
  };

  const pick = (day: number) => {
    onChange(iso(view.year, view.month, day));
    close();
  };

  const first = firstWeekday();
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    // 4 June 2023 was a Sunday; offset lands each locale's week order.
    return weekdayFmt.format(new Date(2023, 5, 4 + ((first + i) % 7)));
  });
  const total = daysIn(view.year, view.month);
  const lead = (new Date(view.year, view.month, 1).getDay() - first + 7) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`datepicker-trigger${open ? ' open' : ''}${value ? '' : ' empty'}`}
        style={width !== undefined ? { width } : undefined}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault();
            openPanel();
          }
        }}
      >
        <CalendarIcon aria-hidden />
        <span className="datepicker-value">{value ? formatDate(value) : placeholder}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="datepicker-panel"
            style={position}
            role="dialog"
            aria-label={ariaLabel}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
            }}
          >
            <div className="datepicker-head">
              <span className="datepicker-month" aria-live="polite">
                {monthFmt.format(new Date(view.year, view.month, 1))}
              </span>
              <span className="datepicker-nav">
                <button type="button" aria-label="previous month" onClick={() => shiftMonth(-1)}>
                  <CaretIcon style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button type="button" aria-label="next month" onClick={() => shiftMonth(1)}>
                  <CaretIcon />
                </button>
              </span>
            </div>
            <div className="datepicker-grid">
              {weekdays.map((label) => (
                <span key={label} className="datepicker-weekday" aria-hidden>
                  {label}
                </span>
              ))}
              {cells.map((day, i) =>
                day === null ? (
                  <span key={`blank-${i}`} aria-hidden />
                ) : (
                  <button
                    key={day}
                    ref={(el) => {
                      dayRefs.current[day] = el;
                    }}
                    type="button"
                    className={`datepicker-day${
                      selected && selected.year === view.year && selected.month === view.month && selected.day === day
                        ? ' selected'
                        : ''
                    }${iso(view.year, view.month, day) === todayIso ? ' today' : ''}`}
                    tabIndex={day === focusDay ? 0 : -1}
                    aria-label={formatDate(iso(view.year, view.month, day))}
                    aria-pressed={value === iso(view.year, view.month, day)}
                    onClick={() => pick(day)}
                    onKeyDown={(e) => {
                      const moves: Record<string, number> = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7,
                      };
                      const delta = moves[e.key];
                      if (delta !== undefined) {
                        e.preventDefault();
                        moveFocus(delta);
                      }
                    }}
                  >
                    {day}
                  </button>
                ),
              )}
            </div>
            <div className="datepicker-foot">
              <button
                type="button"
                className="datepicker-action"
                onClick={() => {
                  onChange(todayIso);
                  close();
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="datepicker-action"
                disabled={value === null}
                onClick={() => {
                  onChange(null);
                  close();
                }}
              >
                Clear
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
