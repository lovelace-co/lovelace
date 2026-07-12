import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  ConfigError,
  loadManifest,
  loadSchema,
  loadActors,
  ProjectError,
  loadProject,
  SPEC_VERSION,
  validateSchema,
} from '../src/index.js';
import { tempFixture, corrupt, unknownKeysFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

describe('manifest', () => {
  it('loads the fixture manifest with default paths', () => {
    const root = fixture();
    const manifest = loadManifest(join(root, '.lovelace'));
    expect(manifest.name).toBe('Orbit Weather Service');
    expect(manifest.spec_version).toBe('3.0.0');
    expect(manifest.paths.tickets).toBe('tickets');
  });

  it('refuses an unknown major spec version with a clear error', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('3.0.0', '4.0.0'));
    expect(() => loadManifest(join(root, '.lovelace'))).toThrowError(/supports 3\.x/);
  });

  it('tolerates a newer minor version', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('3.0.0', '3.9.0'));
    expect(loadManifest(join(root, '.lovelace')).spec_version).toBe('3.9.0');
  });

  it('a too-new project carries code, declared and supported on the ConfigError', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('3.0.0', '4.0.0'));
    try {
      loadManifest(join(root, '.lovelace'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const err = e as ConfigError;
      expect(err.code).toBe('spec-too-new');
      expect(err.declared).toBe('4.0.0');
      expect(err.supported).toBe(SPEC_VERSION);
    }
  });

  it('an older project carries code, declared and supported on the ConfigError', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('3.0.0', '2.1.0'));
    try {
      loadManifest(join(root, '.lovelace'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const err = e as ConfigError;
      expect(err.code).toBe('spec-needs-migration');
      expect(err.declared).toBe('2.1.0');
      expect(err.supported).toBe(SPEC_VERSION);
      expect(err.message).toContain('migrate');
    }
  });

  it('loadProject wraps the ConfigError into a ProjectError, preserving code, declared and supported', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('3.0.0', '2.1.0'));
    try {
      loadProject(root);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectError);
      const err = e as ProjectError;
      expect(err.code).toBe('spec-needs-migration');
      expect(err.declared).toBe('2.1.0');
      expect(err.supported).toBe(SPEC_VERSION);
    }
  });

  it('reports YAML syntax errors with file and line', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => `${t}  bad   indentation: [unclosed\n`);
    try {
      loadProject(root);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectError);
      expect((e as ProjectError).file).toContain('manifest.yaml');
      expect((e as ProjectError).line).toBeGreaterThan(0);
    }
  });

  it('reports a missing manifest as an error, not a crash', () => {
    const root = fixture();
    writeFileSync(join(root, '.lovelace/manifest.yaml'), 'name: only-a-name\n');
    expect(() => loadProject(root)).toThrowError(ProjectError);
  });
});

describe('schema', () => {
  it('loads types with nested fields, statuses and priorities', () => {
    const root = fixture();
    const schema = loadSchema(join(root, '.lovelace'));
    expect(schema.types.map((t) => t.name)).toEqual(['epic', 'task', 'bug']);
    expect(schema.statuses[0]?.name).toBe('backlog');
    expect(schema.priorities).toContain('urgent');
    const bug = schema.types.find((t) => t.name === 'bug');
    expect(bug?.fields.find((f) => f.name === 'environment')?.values).toContain('staging');
    const task = schema.types.find((t) => t.name === 'task');
    expect(task?.fields.find((f) => f.name === 'environment')).toBeUndefined();
  });

  it('statuses carry an optional agent role instead of active/complete flags', () => {
    const root = fixture();
    const schema = loadSchema(join(root, '.lovelace'));
    expect(schema.statuses.find((s) => s.name === 'todo')?.agent).toBe('ready');
    expect(schema.statuses.find((s) => s.name === 'in_progress')?.agent).toBe('in_progress');
    expect(schema.statuses.find((s) => s.name === 'done')?.agent).toBe('complete');
    expect(schema.statuses.find((s) => s.name === 'in_review')?.agent).toBeUndefined();
  });
});

describe('actors', () => {
  it('loads the fixture actors', () => {
    const root = fixture();
    const actors = loadActors(join(root, '.lovelace'));
    expect(actors).toHaveLength(2);
    expect(actors.find((a) => a.kind === 'human')?.id).toBe('ada');
  });
});

// ADR-0011: tolerant reads. Parsing passes unknown keys through instead of
// the zod default of stripping them, so validation can warn on them and
// writeSchema can carry them forward.
describe('passthrough parsing of unknown keys', () => {
  function unknownKeysRoot() {
    const f = unknownKeysFixture();
    cleanups.push(f.cleanup);
    return f.root;
  }

  it('loadManifest keeps an unrecognised top-level key', () => {
    const root = unknownKeysRoot();
    const manifest = loadManifest(join(root, '.lovelace')) as unknown as Record<string, unknown>;
    expect(manifest.theme).toBe('dark');
  });

  it('loadSchema keeps unrecognised keys on the top level, a type, a status and a field', () => {
    const root = unknownKeysRoot();
    const schema = loadSchema(join(root, '.lovelace')) as unknown as Record<string, unknown>;
    expect(schema.board_layout).toBe('kanban');
    const bug = schema.types as Array<Record<string, unknown>>;
    const bugType = bug.find((t) => t.name === 'bug');
    expect(bugType?.colour).toBe('blue');
    const statuses = schema.statuses as Array<Record<string, unknown>>;
    expect(statuses.find((s) => s.name === 'todo')?.icon).toBe('check');
    const fields = bugType?.fields as Array<Record<string, unknown>>;
    expect(fields.find((f) => f.name === 'environment')?.weighting).toBe('high');
  });

  it('validateSchema warns on the type, status and field keys without erroring', () => {
    const root = unknownKeysRoot();
    const schema = loadSchema(join(root, '.lovelace'));
    const issues = validateSchema(schema, '.lovelace/schema.yaml');
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues).toContainEqual({
      severity: 'warning',
      file: '.lovelace/schema.yaml',
      rule: 'schema/unknown-key',
      message: 'type "bug" carries unknown key "colour"',
    });
  });
});
