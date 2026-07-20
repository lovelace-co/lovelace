import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPEC_VERSION } from '../src/index.js';

const SPEC_MD = resolve(__dirname, '../../../SPEC.md');
const text = readFileSync(SPEC_MD, 'utf8');

// Three sites in SPEC.md state the version in prose. None of them import
// SPEC_VERSION, so a bump there is silent unless a test ties them back to it.
describe('SPEC.md version sites match SPEC_VERSION', () => {
  it('the title line ("Version X.Y.Z") matches', () => {
    const match = /^Version (\d+\.\d+\.\d+)$/m.exec(text);
    expect(match, 'SPEC.md is missing the "Version X.Y.Z" title line').not.toBeNull();
    expect(match![1]).toBe(SPEC_VERSION);
  });

  it('the "4. Spec versioning" prose statement matches', () => {
    const match = /The current version is `(\d+\.\d+\.\d+)`/.exec(text);
    expect(match, 'SPEC.md is missing the "The current version is `X.Y.Z`" sentence').not.toBeNull();
    expect(match![1]).toBe(SPEC_VERSION);
  });

  it('the manifest.yaml example\'s spec_version matches', () => {
    const match = /^spec_version: (\d+\.\d+\.\d+)/m.exec(text);
    expect(match, 'SPEC.md is missing the "spec_version: X.Y.Z" manifest example line').not.toBeNull();
    expect(match![1]).toBe(SPEC_VERSION);
  });
});
