/**
 * Decides what a watcher event does to the store: reload straight away, or
 * defer until the app's own mutation (plus its settle tail) has finished.
 * Deferred events collapse into a single replay so a burst of writes during
 * a mutation only triggers one reload once the window closes. An in-window
 * event is almost always the mutation's own write echoing back, so it never
 * raises the external-change toast, only outside-window events do that; the
 * reload alone is enough to pick up a genuinely concurrent agent change.
 * Mutations can overlap (a second one starting before the first's settle
 * tail ends), so the window is a depth counter, not a flag: only the
 * outermost end reopens the gate and hands back the replay.
 * Pure and DOM-free so the gating logic is testable on its own.
 */
export interface ChangeGate {
  /** Call for every watcher event. Returns true when the caller should
   *  reload now; false means the event was deferred. Presence-only-ness
   *  plays no part here: it only ever decided the toast, which a deferred
   *  replay never raises. */
  onEvent(): boolean;
  /** Marks the start of a mutation window. Windows nest: a second call
   *  before the matching end keeps the gate closed. */
  beginMutation(): void;
  /** Marks the end of a mutation window (the settle tail included).
   *  Returns whether anything deferred during the window needs a replay.
   *  Only the call that closes the outermost window can return true; an
   *  inner end leaves the deferred state for the outer end to report. */
  endMutation(): boolean;
}

export function createChangeGate(): ChangeGate {
  let depth = 0;
  let deferred = false;

  return {
    onEvent() {
      if (depth === 0) return true;
      deferred = true;
      return false;
    },
    beginMutation() {
      // Does not touch the deferred flag: a mutation that starts before the
      // previous one's deferred event has been replayed must not drop it.
      depth += 1;
    },
    endMutation() {
      depth = Math.max(0, depth - 1);
      if (depth > 0) return false;
      const replay = deferred;
      deferred = false;
      return replay;
    },
  };
}
