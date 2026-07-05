import { describe, expect, it } from 'vitest';
import { basename, buildLinkResolver, referenceCandidates } from '../src/lib/links';
import type { Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const snap = fixture as unknown as Snapshot;

describe('reference resolver', () => {
  const resolve = buildLinkResolver(snap);

  it('resolves a ticket id to its current title', () => {
    expect(resolve('T-0002')).toMatchObject({ kind: 'ticket', id: 'T-0002', label: 'Forecast endpoint' });
  });

  it('resolves a document id to its title-cased name', () => {
    expect(resolve('architecture-overview')).toMatchObject({ kind: 'document', label: 'Architecture Overview' });
  });

  it('resolves a file: token to a file target labelled by basename', () => {
    expect(resolve('file:src/cache/store.ts')).toEqual({
      kind: 'file',
      id: 'file:src/cache/store.ts',
      label: 'store.ts',
      path: 'src/cache/store.ts',
    });
  });

  it('resolves an @actor token to a person when the actor exists', () => {
    expect(resolve('@claude')).toMatchObject({ kind: 'person', id: '@claude', label: 'Claude Code' });
    expect(resolve('@nobody')).toBeNull();
  });

  it('returns null for an unknown bare token', () => {
    expect(resolve('does-not-exist')).toBeNull();
  });
});

describe('referenceCandidates', () => {
  it('includes tickets, documents and files (as file: tokens)', () => {
    const cands = referenceCandidates(snap, ['src/a.ts', 'docs/README.md']);
    expect(cands.some((c) => c.kind === 'ticket')).toBe(true);
    expect(cands.some((c) => c.kind === 'document')).toBe(true);
    const file = cands.find((c) => c.kind === 'file');
    expect(file).toMatchObject({ token: 'file:src/a.ts', label: 'a.ts', hint: 'src/a.ts' });
  });

  it('basename takes the last path segment', () => {
    expect(basename('a/b/c.ts')).toBe('c.ts');
    expect(basename('top.md')).toBe('top.md');
  });
});
