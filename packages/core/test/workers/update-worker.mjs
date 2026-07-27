// Hammers updateTicket on one ticket until the deadline; reports a tally on
// stdout as JSON. Spawned by concurrency.spec.ts; imports the built package
// since it runs as a separate process, not through vitest's loader.
import { updateTicket } from '../../dist/index.js';

const [root, id, mode, ms] = process.argv.slice(2);
const deadline = Date.now() + Number(ms);
const tally = { ok: 0, errors: {} };
let n = 0;
while (Date.now() < deadline) {
  try {
    if (mode === 'title') {
      await updateTicket(root, id, { fields: { title: `stress ${n}` } });
    } else {
      await updateTicket(root, id, { fields: { status: n % 2 === 0 ? 'in_progress' : 'todo' } });
    }
    tally.ok++;
  } catch (e) {
    const key = String(e instanceof Error ? e.message : e).slice(0, 100);
    tally.errors[key] = (tally.errors[key] ?? 0) + 1;
  }
  n++;
}
console.log(JSON.stringify(tally));
