// Hammers beatPresence on one session id, as many times as given. Spawned by
// concurrency.spec.ts's presence atomicity test; imports the built package
// since it runs as a separate process, not through vitest's loader.
import { beatPresence } from '../../dist/index.js';

const [root, sessionId, iters] = process.argv.slice(2);
for (let i = 0; i < Number(iters); i++) {
  beatPresence(root, sessionId);
}
