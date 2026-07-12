/**
 * The one place the spec version lives (ADR-0011). Every consumer -
 * validation, the host envelope, the app - routes version comparisons
 * through classifySpecVersion instead of comparing majors by hand.
 */
export const SPEC_VERSION = '3.2.0';
export const SUPPORTED_SPEC_MAJOR = Number(SPEC_VERSION.split('.')[0]);

/**
 * How a project's declared spec version relates to this tooling's
 * supported major. Only the major matters: minor and patch differences
 * are always 'ok' (ADR-0011 tolerates them).
 */
export type SpecFit = 'ok' | 'too-new' | 'needs-migration';

/**
 * Classifies a declared spec version against SUPPORTED_SPEC_MAJOR. Callers
 * pass validated manifest values; anything else is a programming error, so
 * a malformed string throws rather than comparing NaN and answering 'ok'.
 */
export function classifySpecVersion(declared: string): SpecFit {
  if (!/^\d+\.\d+\.\d+$/.test(declared)) {
    throw new TypeError(`not a semver string: "${declared}"`);
  }
  const major = Number(declared.split('.')[0]);
  if (major > SUPPORTED_SPEC_MAJOR) return 'too-new';
  if (major < SUPPORTED_SPEC_MAJOR) return 'needs-migration';
  return 'ok';
}
