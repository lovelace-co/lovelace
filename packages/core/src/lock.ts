import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest } from './config.js';
import { MutationError } from './mutate.js';
import { writeFileAtomic } from './fs-atomic.js';

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;

// Stealing recovers a lock a crashed holder left behind (a hard kill skips
// the finally that would have released it); 30 s keeps this comfortably
// clear of a slow but legitimate mutation (a huge project, a machine that
// slept mid-write), which the previous 10 s cap sat too close to.
const STALE_LOCK_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A per-acquire unique token, so a release only ever tears down the lock
// this call itself acquired, never a stranger's.
let nonceCounter = 0;
function nextToken(): string {
  nonceCounter += 1;
  return `${process.pid}.${nonceCounter}`;
}

function ownerFile(lockDir: string): string {
  return join(lockDir, 'owner');
}

/** The token written by the current holder, or null on any missing/unreadable file. */
function readOwner(lockDir: string): string | null {
  try {
    return readFileSync(ownerFile(lockDir), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Serialises the whole load-modify-write-reindex span of a mutation against
 * one project, the same way ids.ts serialises counter increments: mkdir is
 * atomic, so it doubles as a mutex. `fn` must call loadProject itself, from
 * inside the callback, so it always reads a state no concurrent mutation can
 * change out from under it before this call releases the lock.
 *
 * Each acquire stamps an owner token (pid.counter) inside the lock
 * directory and holds it locally, so release only ever removes a lock this
 * call itself still owns: a lock this call lost to a steal is never torn
 * down out from under its new holder, and a mutation stolen mid-flight
 * still reports its own result (or error) rather than throwing over a
 * directory that is no longer there. Stealing a stale lock renames it aside
 * before removing it; rename is atomic, so exactly one concurrent stealer
 * wins, and every loser simply retries the acquire loop.
 */
export async function withMutateLock<T>(lovelaceDir: string, fn: () => Promise<T>): Promise<T> {
  const manifest = loadManifest(lovelaceDir);
  const stateDir = join(lovelaceDir, manifest.paths.state);
  mkdirSync(stateDir, { recursive: true });
  const lockDir = join(stateDir, 'mutate.lock');
  const token = nextToken();

  const start = Date.now();
  for (;;) {
    let acquired = false;
    try {
      mkdirSync(lockDir);
      acquired = true;
    } catch {
      acquired = false;
    }

    if (acquired) {
      try {
        writeFileAtomic(ownerFile(lockDir), token);
      } catch (e) {
        // Held the raw directory but could not stamp ownership; release it
        // rather than leave an ownerless lock no release call would ever
        // recognise as its own.
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // Best effort; the original write failure is what matters.
        }
        throw e;
      }
      break;
    }

    // mkdir failed: either genuine contention, or a lock a crashed process
    // never released. Steal only the latter, and only via an atomic rename
    // so at most one concurrent stealer ever wins it.
    let stolen = false;
    try {
      const stat = statSync(lockDir);
      if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        const graveyard = `${lockDir}.steal.${token}`;
        try {
          renameSync(lockDir, graveyard);
          rmSync(graveyard, { recursive: true, force: true });
          stolen = true;
        } catch {
          // Another stealer won the rename, or the holder released the
          // lock in the meantime; fall through and retry the acquire loop.
        }
      }
    } catch {
      // The lock vanished between the failed mkdir and this stat (the
      // holder just released it); fall through and retry the mkdir.
    }
    if (stolen) continue;

    if (Date.now() - start > LOCK_TIMEOUT_MS) {
      throw new MutationError(`timed out waiting for the project mutation lock at ${lockDir}`);
    }
    await sleep(LOCK_RETRY_MS);
  }

  try {
    return await fn();
  } finally {
    // Only release the lock this call itself holds. A token mismatch (or
    // the lock simply being gone) means it was stolen mid-mutation: the
    // mutation's own result or error still stands, so this stays quiet
    // rather than throwing over a lock it no longer owns.
    try {
      if (readOwner(lockDir) === token) {
        rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      // Never let releasing the lock mask the mutation's real outcome.
    }
  }
}
