/**
 * Locale-aware date and time rendering. `undefined` as the locale tells
 * Intl to use the runtime's resolved locale, which in the Tauri webview
 * reflects the operating system: a US machine gets "December 10, 2026"
 * and 12-hour time, a UK or Australian machine gets "10 December 2026"
 * and 24-hour time, with no configuration. Stored values stay ISO; only
 * the display is localised.
 */

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Time, with the gap before AM/PM closed up: "3:45 PM" -> "3:45PM". */
function fmtTime(d: Date): string {
  return timeFmt.format(d).replace(/\s+([AaPp][Mm])\b/, '$1');
}

function parse(value: string): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    // Parse pure dates as local to avoid a timezone day-shift.
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Time then full date, e.g. "3:45 PM, 10 December 2026"; date only for pure dates. */
export function formatDateTime(value: string): string {
  const d = parse(value);
  if (!d) return value;
  if (DATE_ONLY.test(value)) return dateFmt.format(d);
  return `${fmtTime(d)}, ${dateFmt.format(d)}`;
}

/** Compact variant with an abbreviated month, e.g. "3:45 PM, 10 Dec 2026". */
export function formatDateTimeShort(value: string): string {
  const d = parse(value);
  if (!d) return value;
  if (DATE_ONLY.test(value)) return dateShortFmt.format(d);
  return `${fmtTime(d)}, ${dateShortFmt.format(d)}`;
}

/** Date only, e.g. "10 December 2026". */
export function formatDate(value: string): string {
  const d = parse(value);
  return d ? dateFmt.format(d) : value;
}

/** Date only with an abbreviated month, e.g. "10 Dec 2026"; for dense columns. */
export function formatDateShort(value: string): string {
  const d = parse(value);
  return d ? dateShortFmt.format(d) : value;
}
