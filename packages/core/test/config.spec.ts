import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadManifest, loadWorkflow, loadActors, ProjectError, loadProject } from '../src/index.js';
import { tempFixture, corrupt } from './helpers.js';

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
    expect(manifest.spec_version).toBe('1.0.0');
    expect(manifest.paths.tickets).toBe('tickets');
  });

  it('refuses an unknown major spec version with a clear error', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('1.0.0', '2.0.0'));
    expect(() => loadManifest(join(root, '.lovelace'))).toThrowError(/major version 1/);
  });

  it('tolerates a newer minor version', () => {
    const root = fixture();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('1.0.0', '1.9.0'));
    expect(loadManifest(join(root, '.lovelace')).spec_version).toBe('1.9.0');
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

describe('workflow', () => {
  it('loads types, statuses, transitions, priorities and fields', () => {
    const root = fixture();
    const wf = loadWorkflow(join(root, '.lovelace'));
    expect(wf.types.map((t) => t.name)).toEqual(['epic', 'task', 'bug']);
    expect(wf.statuses[0]?.name).toBe('backlog');
    expect(wf.priorities).toContain('urgent');
    expect(wf.fields.find((f) => f.name === 'environment')?.values).toContain('staging');
    expect(wf.on_transition).toHaveLength(2);
  });

  it('rejects an on_transition rule with both run and agent', () => {
    const root = fixture();
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t.replace('run: ./scripts/archive-artifacts.sh', 'run: ./x.sh\n    agent: do things'),
    );
    expect(() => loadWorkflow(join(root, '.lovelace'))).toThrowError(/exactly one of run or agent/);
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
