import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENCE_TIMEOUT_MINUTES, STILL, derivePresence, formatElapsed } from '../src/lib/presence';

const NOW = Date.parse('2026-07-05T10:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('presence from the hooks markers', () => {
  it('is still when there are no markers', () => {
    expect(derivePresence(null, undefined, NOW)).toEqual(STILL);
    expect(derivePresence(undefined, undefined, NOW)).toEqual(STILL);
    expect(derivePresence([], undefined, NOW)).toEqual(STILL);
  });

  it('is awake on the marked ticket while the marker is fresh', () => {
    const p = derivePresence(
      [{ ticket: 'T-0142', actor: 'claude', started_at: minutesAgo(4), beat_at: minutesAgo(4) }],
      undefined,
      NOW,
    );
    expect(p.awake).toBe(true);
    expect(p.tickets.get('T-0142')).toBe(240);
  });

  it('a marker can be ticketless: awake with no lit ticket', () => {
    const p = derivePresence(
      [{ ticket: null, actor: 'claude', started_at: minutesAgo(1), beat_at: minutesAgo(1) }],
      undefined,
      NOW,
    );
    expect(p.awake).toBe(true);
    expect(p.tickets.size).toBe(0);
  });

  it('falls still once started_at outlives the default cap with no heartbeat', () => {
    const fresh = derivePresence(
      [{ ticket: 'T-0142', actor: null, started_at: minutesAgo(DEFAULT_PRESENCE_TIMEOUT_MINUTES - 1) }],
      undefined,
      NOW,
    );
    const stale = derivePresence(
      [{ ticket: 'T-0142', actor: null, started_at: minutesAgo(DEFAULT_PRESENCE_TIMEOUT_MINUTES + 1) }],
      undefined,
      NOW,
    );
    expect(fresh.awake).toBe(true);
    expect(stale).toEqual(STILL);
  });

  it('a fresh beat_at keeps an old started_at alive, and elapsed still measures from started_at', () => {
    const p = derivePresence(
      [
        {
          ticket: 'T-0142',
          actor: null,
          started_at: minutesAgo(DEFAULT_PRESENCE_TIMEOUT_MINUTES + 30),
          beat_at: minutesAgo(1),
        },
      ],
      undefined,
      NOW,
    );
    expect(p.awake).toBe(true);
    expect(p.tickets.get('T-0142')).toBe((DEFAULT_PRESENCE_TIMEOUT_MINUTES + 30) * 60);
  });

  it('honours a per-project cap from the manifest', () => {
    const marker = { ticket: 'T-0142', actor: null, started_at: minutesAgo(180), beat_at: minutesAgo(180) };
    expect(derivePresence([marker], 120, NOW)).toEqual(STILL);
    expect(derivePresence([marker], 480, NOW).awake).toBe(true);
  });

  it('treats clock skew from the future as just started', () => {
    const p = derivePresence(
      [{ ticket: 'T-0142', actor: null, started_at: minutesAgo(-2), beat_at: minutesAgo(-2) }],
      undefined,
      NOW,
    );
    expect(p.awake).toBe(true);
    expect(p.tickets.get('T-0142')).toBe(0);
  });

  it('ignores an unreadable marker rather than guessing', () => {
    const p = derivePresence([{ ticket: 'T-0142', actor: null, started_at: 'not a date' }], undefined, NOW);
    expect(p).toEqual(STILL);
  });

  it('two sessions on two different tickets light both', () => {
    const p = derivePresence(
      [
        { ticket: 'T-0001', actor: 'claude', started_at: minutesAgo(1), beat_at: minutesAgo(1) },
        { ticket: 'T-0002', actor: 'claude', started_at: minutesAgo(3), beat_at: minutesAgo(3) },
      ],
      undefined,
      NOW,
    );
    expect(p.awake).toBe(true);
    expect(p.tickets.get('T-0001')).toBe(60);
    expect(p.tickets.get('T-0002')).toBe(180);
  });

  it('two sessions on one ticket keep the earliest start, the larger elapsed', () => {
    const p = derivePresence(
      [
        { ticket: 'T-0001', actor: 'claude', started_at: minutesAgo(1), beat_at: minutesAgo(1) },
        { ticket: 'T-0001', actor: 'ada', started_at: minutesAgo(10), beat_at: minutesAgo(0) },
      ],
      undefined,
      NOW,
    );
    expect(p.awake).toBe(true);
    expect(p.tickets.size).toBe(1);
    expect(p.tickets.get('T-0001')).toBe(600);
  });
});

describe('formatElapsed', () => {
  it('shows plain seconds under a minute, then minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(42)).toBe('42s');
    expect(formatElapsed(60)).toBe('1m 0s');
    expect(formatElapsed(83)).toBe('1m 23s');
    expect(formatElapsed(3700)).toBe('61m 40s');
  });
});
