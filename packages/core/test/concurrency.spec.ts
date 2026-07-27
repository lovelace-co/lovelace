import { describe, expect, it, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  updateTicket,
  withMutateLock,
  writeFileAtomic,
  beatPresence,
  readPresences,
  loadProject,
  setColumnOrder,
  readBoardOrder,
  writeIndex,
  MutationError,
} from '../src/index.js';
import { tempFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

const DIST_INDEX = resolve(__dirname, '../dist/index.js');
const WORKERS_DIR = join(__dirname, 'workers');

// Every stress test in this file spawns a real Node child process that
// imports the built package, not the TS source vitest runs the rest of this
// suite against; a stale or missing build would otherwise let these tests
// silently exercise old code (or fail with a confusing module-not-found
// error) instead of failing clearly. CI always builds first; this never
// skips silently.
if (!existsSync(DIST_INDEX)) {
  throw new Error('packages/core/dist is missing: run pnpm build before pnpm test');
}

function spawnWorker(script: string, args: string[]) {
  return spawn(process.execPath, [join(WORKERS_DIR, script), ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

describe('presence atomicity under concurrent beats', () => {
  it('every raw read of the entry file is either absent or a whole, valid entry, with one started_at', async () => {
    const root = fixture();
    const sessionId = 'stress-session';
    const entry = join(root, '.lovelace/state/presence', `${sessionId}.json`);
    const WORKERS = 3;
    const ITERS = 1500;

    const children = Array.from({ length: WORKERS }, () =>
      spawnWorker('beat-worker.mjs', [root, sessionId, String(ITERS)]),
    );

    let alive = children.length;
    for (const child of children) child.on('exit', () => alive--);

    const tally = { empty: 0, torn: 0, ok: 0 };
    const startedAts = new Set<string>();
    let n = 0;
    while (alive > 0) {
      if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
      let raw: string;
      try {
        raw = readFileSync(entry, 'utf8');
      } catch {
        // Not yet created by the first beat; not a torn or empty read.
        continue;
      }
      if (raw.length === 0) {
        tally.empty++;
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as { started_at?: unknown };
        if (typeof parsed.started_at === 'string') {
          tally.ok++;
          startedAts.add(parsed.started_at);
        } else {
          tally.torn++;
        }
      } catch {
        tally.torn++;
      }
    }

    expect(tally.empty).toBe(0);
    expect(tally.torn).toBe(0);
    expect(tally.ok).toBeGreaterThan(0);
    expect(startedAts.size).toBe(1);
  }, 10_000);
});

describe('index integrity under concurrent updateTicket', () => {
  it('index.json stays parseable and never drops a fixture ticket while two workers race', async () => {
    const root = fixture();
    const indexFile = join(root, '.lovelace/index/index.json');
    const project = loadProject(root);
    const allIds = project.tickets.map((t) => t.id).sort();
    const RUN_MS = 2000;

    // index.json is derived and gitignored, so the copied fixture carries
    // either no index at all (a fresh clone) or whatever a previous local
    // run happened to leave behind. Generate it from the fixture's own
    // files first: the assertions below are about what the race does to a
    // valid index, not about the state the fixture was copied in.
    writeIndex(project);

    const a = spawnWorker('update-worker.mjs', [root, 'T-0001', 'title', String(RUN_MS)]);
    const b = spawnWorker('update-worker.mjs', [root, 'T-0002', 'title', String(RUN_MS)]);
    let outA = '';
    let outB = '';
    a.stdout.on('data', (d) => (outA += d));
    b.stdout.on('data', (d) => (outB += d));

    let alive = 2;
    for (const child of [a, b]) child.on('exit', () => alive--);

    const tally = { tornIndex: 0, missing: {} as Record<string, number> };
    let n = 0;
    while (alive > 0) {
      if (++n % 100 === 0) await new Promise((r) => setImmediate(r));
      let parsed: { tickets?: Array<{ id: string }> };
      try {
        parsed = JSON.parse(readFileSync(indexFile, 'utf8'));
      } catch {
        tally.tornIndex++;
        continue;
      }
      const ids = new Set((parsed.tickets ?? []).map((t) => t.id));
      for (const id of allIds) {
        if (!ids.has(id)) tally.missing[id] = (tally.missing[id] ?? 0) + 1;
      }
    }

    const tallyA = JSON.parse(outA) as { ok: number; errors: Record<string, number> };
    const tallyB = JSON.parse(outB) as { ok: number; errors: Record<string, number> };

    expect(tally.tornIndex).toBe(0);
    expect(tally.missing).toEqual({});
    expect(tallyA.errors).toEqual({});
    expect(tallyB.errors).toEqual({});
    expect(tallyA.ok).toBeGreaterThan(0);
    expect(tallyB.ok).toBeGreaterThan(0);
  }, 10_000);
});

describe('no lost updates under a concurrent status move', () => {
  it('every status move that returns success is present in the file once things quiesce', async () => {
    const root = fixture();
    const ticketFile = join(root, '.lovelace/tickets/T-0003.md');
    const TRIALS = 8;
    const TRIAL_MS = 300;
    const statusOf = () => /\nstatus: (.+)\n/.exec(readFileSync(ticketFile, 'utf8'))?.[1];

    let moveOk = 0;
    let lostUpdates = 0;
    for (let t = 0; t < TRIALS; t++) {
      const target = t % 2 === 0 ? 'done' : 'in_review';
      const worker = spawn(
        process.execPath,
        [join(WORKERS_DIR, 'update-worker.mjs'), root, 'T-0003', 'title', String(TRIAL_MS)],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      const exited = new Promise((r) => worker.on('exit', r));
      await new Promise((r) => setTimeout(r, TRIAL_MS / 2));
      let moved = false;
      try {
        await updateTicket(root, 'T-0003', { fields: { status: target } });
        moved = true;
        moveOk++;
      } catch {
        // A lock timeout or validation error here is not itself a lost
        // update; only a move that returned success and then vanished counts.
      }
      await exited;
      if (moved && statusOf() !== target) lostUpdates++;
    }

    expect(moveOk).toBeGreaterThan(0);
    expect(lostUpdates).toBe(0);
  }, 10_000);
});

describe('withMutateLock', () => {
  it('makes a mutation wait for a lock a concurrent holder releases', async () => {
    const root = fixture();
    const stateDir = join(root, '.lovelace', 'state');
    const lockDir = join(stateDir, 'mutate.lock');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(lockDir);

    let resolved = false;
    const pending = updateTicket(root, 'T-0003', { fields: { title: 'held' } }).then((r) => {
      resolved = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(resolved).toBe(false);

    rmdirSync(lockDir);
    const result = await pending;
    expect(resolved).toBe(true);
    expect(result.ticket.fields.title).toBe('held');
  });

  it('steals a lock directory whose mtime is older than the stale cap, without waiting out the timeout', async () => {
    const root = fixture();
    const lovelaceDir = join(root, '.lovelace');
    const stateDir = join(lovelaceDir, 'state');
    const lockDir = join(stateDir, 'mutate.lock');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(lockDir);
    // The stale cap is 30 s; back-date well past it.
    const stale = new Date(Date.now() - 35_000);
    utimesSync(lockDir, stale, stale);

    const start = Date.now();
    const result = await withMutateLock(lovelaceDir, async () => 'done');

    expect(result).toBe('done');
    expect(Date.now() - start).toBeLessThan(1000);
    // Released again once fn returns, same as an ordinary acquire.
    expect(existsSync(lockDir)).toBe(false);
  });

  it('does not throw when its own lock is stolen mid-mutation, and leaves the new holder\'s lock alone', async () => {
    const root = fixture();
    const lovelaceDir = join(root, '.lovelace');
    const stateDir = join(lovelaceDir, 'state');
    const lockDir = join(stateDir, 'mutate.lock');

    const result = await withMutateLock(lovelaceDir, async () => {
      // Simulate a concurrent steal happening mid-mutation: move this
      // call's own lock directory aside (as a real stealer's atomic rename
      // would) and install an impostor lock with a different owner token
      // in its place, exactly as a new legitimate holder would look after
      // winning the steal race.
      const graveyard = `${lockDir}.simulated-steal`;
      renameSync(lockDir, graveyard);
      rmSync(graveyard, { recursive: true, force: true });
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner'), 'impostor-token');
      return 'mutation result';
    });

    // The mutation's own result stands; the finally must not have thrown
    // over the directory it no longer owns, and must not have torn down
    // the impostor's lock either.
    expect(result).toBe('mutation result');
    expect(readFileSync(join(lockDir, 'owner'), 'utf8')).toBe('impostor-token');
  });

  it('never lets two concurrent stealers of the same stale lock both enter the critical section', async () => {
    const root = fixture();
    const lovelaceDir = join(root, '.lovelace');
    const stateDir = join(lovelaceDir, 'state');
    const lockDir = join(stateDir, 'mutate.lock');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(lockDir);
    const stale = new Date(Date.now() - 35_000);
    utimesSync(lockDir, stale, stale);

    // Two real OS processes racing to steal the same stale lock, the class
    // of race a single Node process cannot reproduce on its own (mkdir,
    // stat and rename here are all synchronous, so nothing else in the same
    // process can interleave between them). Each reports its own wall-clock
    // enter/exit around the critical section; the two intervals must not
    // overlap.
    const HOLD_MS = 200;
    const a = spawnWorker('lock-worker.mjs', [root, String(HOLD_MS)]);
    const b = spawnWorker('lock-worker.mjs', [root, String(HOLD_MS)]);
    let outA = '';
    let outB = '';
    a.stdout.on('data', (d) => (outA += d));
    b.stdout.on('data', (d) => (outB += d));
    await Promise.all([new Promise((r) => a.on('exit', r)), new Promise((r) => b.on('exit', r))]);

    const ra = JSON.parse(outA) as { enter: number; exit: number };
    const rb = JSON.parse(outB) as { enter: number; exit: number };
    const overlap = ra.enter < rb.exit && rb.enter < ra.exit;
    expect(overlap).toBe(false);
  }, 10_000);

  it('throws a clear MutationError once the lock timeout is reached', async () => {
    const root = fixture();
    const lovelaceDir = join(root, '.lovelace');
    const stateDir = join(lovelaceDir, 'state');
    const lockDir = join(stateDir, 'mutate.lock');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(lockDir);
    // Keep the lock's mtime fresh throughout so it is never stolen, forcing
    // the genuine 5 s timeout rather than the stale-lock shortcut above.
    const keepFresh = setInterval(() => {
      const now = new Date();
      try {
        utimesSync(lockDir, now, now);
      } catch {
        // The lock directory is gone; nothing left to keep fresh.
      }
    }, 200);

    let error: unknown;
    try {
      await withMutateLock(lovelaceDir, async () => 'never');
    } catch (e) {
      error = e;
    } finally {
      clearInterval(keepFresh);
    }

    expect(error).toBeInstanceOf(MutationError);
    expect((error as Error).message).toMatch(/timed out waiting for the project mutation lock/);
  }, 8000);
});

describe('setColumnOrder locking', () => {
  it('waits for a lock a concurrent holder releases, the same as updateTicket', async () => {
    const root = fixture();
    const stateDir = join(root, '.lovelace', 'state');
    const lockDir = join(stateDir, 'mutate.lock');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(lockDir);

    const project = loadProject(root);
    const ids = project.tickets.map((t) => t.id);

    let resolved = false;
    const pending = setColumnOrder(root, 'todo', [ids[0]!]).then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(resolved).toBe(false);

    rmdirSync(lockDir);
    await pending;
    expect(resolved).toBe(true);
    expect(readBoardOrder(project.dir).todo).toEqual([ids[0]]);
  });
});

describe('beatPresence attribution', () => {
  it("prefers this session's own marker over the existing entry's ticket", () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    writeFileSync(
      join(root, '.lovelace/state/presence/session-a.json'),
      `${JSON.stringify({
        ticket: 'T-0002',
        actor: 'claude',
        started_at: '2026-07-05T09:00:00Z',
        beat_at: '2026-07-05T09:00:00Z',
      })}\n`,
    );
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0004\n');

    beatPresence(root, 'session-a');
    expect(readPresences(root)[0]?.ticket).toBe('T-0004');
  });

  it('preserves the existing entry\'s ticket when no per-session marker exists', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    writeFileSync(
      join(root, '.lovelace/state/presence/session-a.json'),
      `${JSON.stringify({
        ticket: 'T-0002',
        actor: 'claude',
        started_at: '2026-07-05T09:00:00Z',
        beat_at: '2026-07-05T09:00:00Z',
      })}\n`,
    );

    beatPresence(root, 'session-a');
    expect(readPresences(root)[0]?.ticket).toBe('T-0002');
  });

  it('never picks up the singleton state/active_ticket on its own', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');

    beatPresence(root, 'session-a');
    expect(readPresences(root)[0]?.ticket).toBeNull();
  });

  it('gives ticket: null when there is no marker and no existing entry', () => {
    const root = fixture();
    beatPresence(root, 'session-a');
    expect(readPresences(root)[0]?.ticket).toBeNull();
  });
});

describe('writeFileAtomic', () => {
  it('writes exact content and leaves no temp files behind', () => {
    const root = fixture();
    const dir = join(root, 'scratch');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'atomic.txt');
    const content = 'exact bytes, no more, no less\n';

    writeFileAtomic(file, content);

    expect(readFileSync(file, 'utf8')).toBe(content);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves the target file mode across a rewrite', () => {
    const root = fixture();
    const dir = join(root, 'scratch');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'mode.txt');

    writeFileSync(file, 'one');
    chmodSync(file, 0o600);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    writeFileAtomic(file, 'two');

    expect(readFileSync(file, 'utf8')).toBe('two');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
