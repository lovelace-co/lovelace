import { describe, expect, it } from 'vitest';
import { classifySpecVersion, SPEC_VERSION, SUPPORTED_SPEC_MAJOR } from '../src/index.js';

describe('classifySpecVersion', () => {
  it('classifies a higher major as too-new', () => {
    expect(classifySpecVersion('4.0.0')).toBe('too-new');
  });

  it('classifies a lower major as needs-migration', () => {
    expect(classifySpecVersion('2.1.0')).toBe('needs-migration');
  });

  it('classifies the same major as ok regardless of minor or patch', () => {
    expect(classifySpecVersion('3.0.0')).toBe('ok');
    expect(classifySpecVersion('3.9.9')).toBe('ok');
  });

  it('classifies both the 3.0.0 floor and the current 3.2.0 as ok (ADR-0011: the declared version is a floor)', () => {
    expect(classifySpecVersion('3.0.0')).toBe('ok');
    expect(classifySpecVersion('3.2.0')).toBe('ok');
  });

  it('throws on a malformed version instead of comparing NaN', () => {
    expect(() => classifySpecVersion('abc')).toThrow('not a semver string');
    expect(() => classifySpecVersion('')).toThrow('not a semver string');
    expect(() => classifySpecVersion('3.0.0-beta')).toThrow('not a semver string');
  });
});

describe('SUPPORTED_SPEC_MAJOR', () => {
  it('is derived from SPEC_VERSION, never declared separately', () => {
    expect(SUPPORTED_SPEC_MAJOR).toBe(Number(SPEC_VERSION.split('.')[0]));
  });
});

describe('SPEC_VERSION', () => {
  it('is 3.2.0 (ADR-0011: tolerant reads and non-destructive writes)', () => {
    expect(SPEC_VERSION).toBe('3.2.0');
  });
});
