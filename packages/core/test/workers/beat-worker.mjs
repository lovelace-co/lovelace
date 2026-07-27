// Hammers beatPresence on one session id, as many times as given, and
// reports a tally on stdout as JSON. Spawned by concurrency.spec.ts's
// presence atomicity test; imports the built package since it runs as a
// separate process, not through vitest's loader.
//
// The tally matters as much as the beats do: an unguarded loop here dies on
// the first write error, which ends the spec's polling loop early and lets
// the test pass having barely run. Reporting instead keeps a failed write
// visible to the assertions.
import { beatPresence } from '../../dist/index.js';

const [root, sessionId, iters] = process.argv.slice(2);
const tally = { ok: 0, errors: {} };
for (let i = 0; i < Number(iters); i++) {
  try {
    beatPresence(root, sessionId);
    tally.ok++;
  } catch (e) {
    const key = String(e instanceof Error ? e.message : e).slice(0, 100);
    tally.errors[key] = (tally.errors[key] ?? 0) + 1;
  }
}
console.log(JSON.stringify(tally));
