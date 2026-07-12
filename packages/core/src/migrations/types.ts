/**
 * The migration framework (ADR-0011). A registry in packages/core holds one
 * step per major boundary; each step is small, testable in isolation, and
 * patches YAML documents the same way the mutation layer does, so a
 * migrated file keeps comments and produces a minimal diff.
 */

/** The dry-run result of a migration step: what will change, in plain English. */
export interface MigrationPlan {
  /** One sentence describing the step. */
  summary: string;
  /** Human-readable lines, computed from the actual files, naming each decision. */
  changes: string[];
}

export interface MigrationStep {
  /** The major this step upgrades from. */
  from: number;
  /** The major this step produces. */
  to: number;
  /** One plain-English sentence shown to the user. */
  summary: string;
  /** Dry run: lists which files change and how, without touching anything. */
  plan(root: string): MigrationPlan;
  /** Executes the file transforms. */
  apply(root: string): void;
}
