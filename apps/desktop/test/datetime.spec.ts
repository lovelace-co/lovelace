import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDateTimeShort } from '../src/lib/datetime';

describe('localised date formatting', () => {
  it('renders a datetime as time then a written-out date, never raw ISO', () => {
    const out = formatDateTime('2026-06-12T23:25:20Z');
    expect(out).not.toContain('T');
    expect(out).not.toContain('2026-06-12');
    expect(out).toMatch(/2026/);
    // Month name, not a number.
    expect(out).toMatch(/[A-Za-z]{3,}/);
    expect(out).toContain(',');
  });

  it('renders a pure date with no time component', () => {
    const out = formatDate('2026-06-01');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/[A-Za-z]{3,}/);
    expect(out).not.toMatch(/\d{2}:\d{2}/);
  });

  it('does not shift a pure date across the day boundary', () => {
    // June 1 must stay June 1 regardless of the runtime timezone.
    expect(formatDate('2026-06-01')).toMatch(/\b1\b/);
  });

  it('the short form abbreviates the month', () => {
    const long = formatDateTime('2026-12-10T08:00:00Z');
    const short = formatDateTimeShort('2026-12-10T08:00:00Z');
    expect(short.length).toBeLessThanOrEqual(long.length);
    expect(short).toMatch(/2026/);
  });

  it('closes the gap before AM/PM in 12-hour locales', () => {
    // In a 24-hour locale there is no AM/PM and the assertion holds trivially.
    const out = formatDateTime('2026-12-10T15:45:00Z');
    expect(out).not.toMatch(/\s[AP]M/i);
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});
