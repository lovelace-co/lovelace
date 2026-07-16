/**
 * A structured copy of SPEC.md's changelog ("Changes by version:"). The
 * shipped desktop app is a self-contained sidecar operating on a user's
 * project, so it cannot read this repository's own SPEC.md off disk; this is
 * the display copy it reads instead, so the pre-migration screen can show
 * the real, human-written release notes. test/changelog.spec.ts parses
 * SPEC.md's changelog section and asserts it matches this array exactly, so
 * the two can never silently drift apart.
 */

export interface ChangelogEntry {
  version: string;
  description: string;
}

/** Newest first, mirroring SPEC.md's changelog bullet order. */
export const SPEC_CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.2.0',
    description:
      'replaces the singleton `state/presence.json` live-agent marker with per-session entries, `state/presence/<session-id>.json`, each carrying a `beat_at` heartbeat refreshed on every tool call (see 12). This supersedes the singleton, which current tooling reads as a single legacy entry and removes on its next presence write. The `presence_timeout_minutes` default drops from 120 to 15 now that heartbeats refresh liveness on every tool call rather than only at turn start. Backward compatible: projects declaring `3.1.0` remain valid.',
  },
  {
    version: '3.1.0',
    description:
      'documents the version semantics (majors migrate, minors are additive and tolerated, patches are prose), requires tooling to preserve unknown keys through writes and surface them as warnings rather than stripping them, distinguishes the too-new refusal (update the app) from the too-old refusal (migrate the project), and states the declared version is a floor rewritten only by migrations. Adds the machine-local `state/active/<session-id>` per-session active-ticket markers (see 12), letting concurrent Claude Code sessions each hold their own active ticket rather than sharing `state/active_ticket`. Backward compatible: projects declaring `3.0.0` remain valid.',
  },
  {
    version: '3.0.0',
    description:
      'renames `workflow.yaml` to `schema.yaml`. Fields are nested under each type instead of living in a shared top-level list, and the `applies_to` key is removed. Statuses carry an optional `agent` role (`ready`, `in_progress` or `complete`, at most one status per role) in place of the `active`/`complete` boolean flags; an agent picks up work in the `ready` status, marks it `in_progress` while working and `complete` when done. Transitions and transition automations are removed entirely, along with `state/agent_instructions.json` and `index/actions.log`; a ticket\'s status may change to any defined status. This is a breaking change over the 2.x line: 3.0 tooling refuses a project declaring a spec version below `3.0.0`.',
  },
  {
    version: '2.1.0',
    description:
      'adds the optional manifest key `presence_timeout_minutes` (positive integer; tooling defaults to 120) and the machine-local `state/presence.json` live-agent marker (see 12). Projects declaring `2.0.0` remain valid.',
  },
  {
    version: '2.0.0',
    description:
      'the knowledge tree is `documentation/` (the `paths.documentation` key, default `documentation`), and its files are "documents". It informs rather than enforces: there are no fixed-name, required files. `documentation/index.md` is a scaffolded-at-init convention, the place an agent starts reading, but it is freely renamable, and a directory\'s `index.md`, when present, is its landing page. Document filenames are unrestricted (any `.md` name, no slug rule; the only guard is no path separators), and nothing under `documentation/` is required; documents that nothing links to surface as orphans in the documentation graph rather than being enforced against. This is a breaking change over the 1.x line, which required fixed-name landing files throughout the knowledge tree: 2.0 tooling refuses a 1.x project.',
  },
  {
    version: '1.6.0',
    description:
      'generalises the `[[...]]` wiki-link into a scheme namespace: a bare token is an entity id (as before), `file:<repo-relative-path>` references a source file, and `@<actor-id>` mentions a person. Only entity-to-entity links enter the index `links` graph; file and person references are display links, never indexed. Backward compatible: existing `[[id]]` bodies are unaffected.',
  },
  {
    version: '1.5.0',
    description:
      'adds the optional, machine-local `state/graph-layout.json` holding manual documentation-graph node positions (see 12). Gitignored and never required for correctness; absent positions fall back to the automatic layout.',
  },
  {
    version: '1.4.0',
    description:
      'adds optional wiki-links (`[[id]]`) in entity bodies and a derived `links` array in the index (see 7.1 and 11). Backward compatible: bodies without wiki-links are unaffected, and a project declaring an earlier version gains the index `links` section when reindexed by current tooling.',
  },
  {
    version: '1.3.0',
    description:
      'removes the cycle entity, the `C-` identifier prefix and the default `cycle` field. The `cycles/` directory is no longer part of the layout, and `cycle` is no longer a valid `refers_to` target. Projects declaring an earlier version that still carry cycle data will see validation errors against the removed constructs.',
  },
  {
    version: '1.2.0',
    description:
      'renames the status flags `wip`/`terminal` to `active`/`complete`, and adds optional human-readable `label` (statuses, types, fields) and `plural` (types). Display names are derived by Title-Casing the machine `name` when absent.',
  },
  {
    version: '1.1.0',
    description: 'adds the optional, backward-compatible `board-order.yaml` (see 2.1). Projects declaring `1.0.0` remain valid.',
  },
  {
    version: '1.0.0',
    description: 'initial specification.',
  },
];

/** Numeric major.minor.patch comparison; negative when `a` is older than `b`. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Changelog entries strictly newer than `declared` and no newer than
 * `target`, ascending. `declared` is exclusive (a project already on that
 * version has already seen its changes); `target` is inclusive, so this
 * never lists an entry the migration itself does not claim.
 */
export function changelogBetween(declared: string, target: string): ChangelogEntry[] {
  return SPEC_CHANGELOG.filter(
    (entry) => compareVersions(entry.version, declared) > 0 && compareVersions(entry.version, target) <= 0,
  ).sort((a, b) => compareVersions(a.version, b.version));
}
