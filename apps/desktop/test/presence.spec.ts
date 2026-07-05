import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENCE_TIMEOUT_MINUTES, STILL, derivePresence } from '../src/lib/presence';

const NOW = Date.parse('2026-07-05T10:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('presence from the hooks marker', () => {
  it('is still when there is no marker', () => {
    expect(derivePresence(null, undefined, NOW)).toEqual(STILL);
    expect(derivePresence(undefined, undefined, NOW)).toEqual(STILL);
  });

  it('is awake on the marked ticket while the marker is fresh', () => {
    const p = derivePresence({ ticket: 'T-0142', actor: 'claude', started_at: minutesAgo(4) }, undefined, NOW);
    expect(p.awake).toBe(true);
    expect(p.focus).toBe('T-0142');
    expect(p.elapsedMinutes).toBe(4);
  });

  it('a marker can be ticketless: awake with no focus', () => {
    const p = derivePresence({ ticket: null, actor: 'claude', started_at: minutesAgo(1) }, undefined, NOW);
    expect(p.awake).toBe(true);
    expect(p.focus).toBeNull();
  });

  it('falls still once the marker outlives the default cap', () => {
    const fresh = derivePresence(
      { ticket: 'T-0142', actor: null, started_at: minutesAgo(DEFAULT_PRESENCE_TIMEOUT_MINUTES - 1) },
      undefined,
      NOW,
    );
    const stale = derivePresence(
      { ticket: 'T-0142', actor: null, started_at: minutesAgo(DEFAULT_PRESENCE_TIMEOUT_MINUTES + 1) },
      undefined,
      NOW,
    );
    expect(fresh.awake).toBe(true);
    expect(stale).toEqual(STILL);
  });

  it('honours a per-project cap from the manifest', () => {
    const marker = { ticket: 'T-0142', actor: null, started_at: minutesAgo(180) };
    expect(derivePresence(marker, 120, NOW)).toEqual(STILL);
    expect(derivePresence(marker, 480, NOW).awake).toBe(true);
  });

  it('treats clock skew from the future as just started', () => {
    const p = derivePresence({ ticket: 'T-0142', actor: null, started_at: minutesAgo(-2) }, undefined, NOW);
    expect(p.awake).toBe(true);
    expect(p.elapsedMinutes).toBe(0);
  });

  it('ignores an unreadable marker rather than guessing', () => {
    const p = derivePresence({ ticket: 'T-0142', actor: null, started_at: 'not a date' }, undefined, NOW);
    expect(p).toEqual(STILL);
  });
});
