import { describe, expect, it, afterEach } from 'vitest';
import { loadProject, buildDigest } from '../src/index.js';
import { tempFixture, FIXED_NOW } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

describe('digest', () => {
  it('orients an agent: in-progress work, recent sessions, warnings', () => {
    const digest = buildDigest(loadProject(fixture()), { now: FIXED_NOW });
    expect(digest).toContain('Orbit Weather Service');
    expect(digest).toContain('T-0002');
    expect(digest).toContain('T-0004');
    expect(digest).not.toMatch(/^\s+T-0001/m); // done is not in progress
    expect(digest).toContain('moves to: in_review'); // legal next statuses for T-0002
    expect(digest).toContain('S-0002 on T-0002: partial');
    expect(digest).toContain('open: Should the 503 test freeze the refresh timer');
    expect(digest).toContain('Warnings');
    expect(digest).toContain('review_by');
  });

  it('stays under roughly 1,500 tokens', () => {
    const digest = buildDigest(loadProject(fixture()), { now: FIXED_NOW });
    expect(digest.length).toBeLessThan(6000);
  });

  it('omits resolved open questions marked None', () => {
    const digest = buildDigest(loadProject(fixture()), { now: FIXED_NOW });
    expect(digest).not.toContain('S-0001 open: None');
  });
});
