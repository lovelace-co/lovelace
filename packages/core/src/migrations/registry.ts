import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { loadProject } from '../project.js';
import { validateProject } from '../validate.js';
import { writeIndex } from '../index-gen.js';
import { MutationError } from '../mutate.js';
import type { MutationContext } from '../mutate.js';
import type { ValidationIssue } from '../types.js';
import { SUPPORTED_SPEC_MAJOR } from '../version.js';
import { changelogBetween } from '../changelog.js';
import type { ChangelogEntry } from '../changelog.js';
import type { MigrationPlan, MigrationStep } from './types.js';
import { v2ToV3 } from './v2-to-v3.js';

/** Anything declaring a major below this predates the migration framework. */
const FLOOR_MAJOR = 2;

/** One step per major boundary, ordered from the floor upward. */
const STEPS: MigrationStep[] = [v2ToV3];

/**
 * The chain of steps that carries a project from `declaredMajor` up to
 * `SUPPORTED_SPEC_MAJOR`. Neither loads the project (a below-floor or
 * needs-migration major would throw before this ever ran); it only walks
 * the registry.
 */
export function migrationPath(declaredMajor: number): MigrationStep[] {
  if (declaredMajor < FLOOR_MAJOR) {
    throw new MutationError(
      `this project declares spec version ${declaredMajor}, which predates supported migrations; recreate it or migrate by hand`,
    );
  }
  if (declaredMajor === SUPPORTED_SPEC_MAJOR) {
    throw new MutationError(
      `this project already declares spec version ${declaredMajor}; there is nothing to migrate`,
    );
  }
  if (declaredMajor > SUPPORTED_SPEC_MAJOR) {
    throw new MutationError(
      `this project declares spec version ${declaredMajor}, which is newer than the supported ${SUPPORTED_SPEC_MAJOR}; update lovelace to open it`,
    );
  }
  const steps: MigrationStep[] = [];
  let major = declaredMajor;
  while (major < SUPPORTED_SPEC_MAJOR) {
    const step = STEPS.find((s) => s.from === major);
    if (!step) {
      throw new MutationError(`no migration is defined from spec version ${major}`);
    }
    steps.push(step);
    major = step.to;
  }
  return steps;
}

/**
 * Reads spec_version straight off manifest.yaml, bypassing loadManifest:
 * loadManifest throws on exactly the versions this module needs to plan or
 * migrate, so the framework can never call loadProject up front.
 */
function readDeclaredSpecVersion(root: string): string {
  const relPath = '.lovelace/manifest.yaml';
  const raw = parseDocument(readFileSync(join(root, relPath), 'utf8'));
  const declared = (raw.toJS() as { spec_version?: unknown }).spec_version;
  if (typeof declared !== 'string' || !/^\d+\.\d+\.\d+$/.test(declared)) {
    throw new MutationError(`${relPath} is missing a valid spec_version`);
  }
  return declared;
}

/**
 * Dry-runs the migration chain for `root`'s declared version: no files
 * change. `target` is the chain's final floor, the version the last step
 * actually stamps (a step's `to` major as x.0.0), not this tooling's full
 * SPEC_VERSION: the declared version is a floor (ADR-0011), and a migration
 * never claims a minor or patch no step produced.
 */
export function planProjectMigration(
  root: string,
): { declared: string; target: string; steps: MigrationPlan[]; releaseNotes: ChangelogEntry[] } {
  const declared = readDeclaredSpecVersion(root);
  const steps = migrationPath(Number(declared.split('.')[0]));
  const lastStep = steps[steps.length - 1];
  const target = `${lastStep.to}.0.0`;
  return {
    declared,
    target,
    steps: steps.map((step) => step.plan(root)),
    releaseNotes: changelogBetween(declared, target),
  };
}

/**
 * Runs the migration chain for `root`'s declared version, then reloads,
 * validates and reindexes. A post-migration validation failure is reported
 * here, never silently repaired: git is the safety net, not this function.
 */
export function migrateProject(
  root: string,
  ctx: MutationContext = {},
): { declared: string; finalVersion: string; steps: string[]; issues: ValidationIssue[] } {
  const declared = readDeclaredSpecVersion(root);
  const steps = migrationPath(Number(declared.split('.')[0]));
  for (const step of steps) step.apply(root);

  const project = loadProject(root);
  const issues = validateProject(project);
  if (!ctx.skipReindex) writeIndex(project);

  return {
    declared,
    finalVersion: project.manifest.spec_version,
    steps: steps.map((step) => step.summary),
    issues,
  };
}
