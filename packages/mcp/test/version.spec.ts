import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION } from '../src/version.js';

const PACKAGE_JSON = resolve(__dirname, '../package.json');

describe('APP_VERSION', () => {
  it('matches the version declared in packages/mcp/package.json', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
