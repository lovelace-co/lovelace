#!/usr/bin/env node
/**
 * Propagates and polices the app release version across every declaration
 * site. Plain Node, no dependencies, so it runs the same way on every CI
 * runner. The root package.json is the single canonical declaration; every
 * other site must mirror it.
 *
 * Usage:
 *   node scripts/release/sync-version.mjs set <x.y.z>
 *   node scripts/release/sync-version.mjs check
 *
 * `set` validates the argument is a plain semver (no prerelease) and writes
 * it into every site below with a targeted regex replacement, never a
 * JSON.parse/JSON.stringify round trip, so surrounding formatting is left
 * untouched. `check` reads the canonical version from the root package.json
 * and confirms every other site matches; it is silent and exits 0 on
 * success, or lists every mismatch on stderr and exits 1.
 *
 * Declaration sites, root package.json first (canonical):
 *   1. package.json (root)
 *   2. packages/core/package.json
 *   3. packages/mcp/package.json
 *   4. apps/desktop/package.json
 *   5. apps/desktop/src-tauri/tauri.conf.json
 *   6. apps/desktop/src-tauri/Cargo.toml ([package] section)
 *   7. apps/desktop/src-tauri/Cargo.lock (the lovelace-desktop [[package]] block)
 *   8. packages/mcp/src/version.ts (the APP_VERSION constant)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function fail(message) {
  console.error(`sync-version: ${message}`);
  process.exit(1);
}

// Matches a JSON file's top-level "version" key (two-space indent). The
// trailing comma is optional and captured so it can be preserved: whether
// "version" is the last key in the object varies by file.
const JSON_TOP_LEVEL_VERSION_RE = /^  "version": "([^"]+)"(,?)$/m;

function readJsonTopLevelVersion(content, label) {
  const match = content.match(JSON_TOP_LEVEL_VERSION_RE);
  if (!match) fail(`could not find a top-level "version" key in ${label}`);
  return match[1];
}

function writeJsonTopLevelVersion(content, version, label) {
  if (!JSON_TOP_LEVEL_VERSION_RE.test(content)) {
    fail(`could not find a top-level "version" key in ${label}`);
  }
  return content.replace(JSON_TOP_LEVEL_VERSION_RE, (_match, _oldVersion, comma) => `  "version": "${version}"${comma}`);
}

/** The [package] section of a Cargo.toml: the slice up to the next `[section]`. */
function packageSection(content, label) {
  const start = content.indexOf('[package]');
  if (start === -1) fail(`could not find a [package] section in ${label}`);
  const afterHeader = start + '[package]'.length;
  const nextSection = content.slice(afterHeader).search(/\n\[/);
  const end = nextSection === -1 ? content.length : afterHeader + nextSection;
  return { start, end };
}

const CARGO_VERSION_RE = /^version = "([^"]+)"$/m;

function readCargoTomlVersion(content, label) {
  const { start, end } = packageSection(content, label);
  const section = content.slice(start, end);
  const match = section.match(CARGO_VERSION_RE);
  if (!match) fail(`could not find a version line in the [package] section of ${label}`);
  return match[1];
}

function writeCargoTomlVersion(content, version, label) {
  const { start, end } = packageSection(content, label);
  const section = content.slice(start, end);
  if (!CARGO_VERSION_RE.test(section)) {
    fail(`could not find a version line in the [package] section of ${label}`);
  }
  const updated = section.replace(CARGO_VERSION_RE, `version = "${version}"`);
  return content.slice(0, start) + updated + content.slice(end);
}

/** The lovelace-desktop [[package]] block in Cargo.lock: from its name line to the next [[package]]. */
function lovelaceDesktopBlock(content, label) {
  const marker = '[[package]]\nname = "lovelace-desktop"\n';
  const markerStart = content.indexOf(marker);
  if (markerStart === -1) fail(`could not find the lovelace-desktop [[package]] block in ${label}`);
  const start = markerStart + marker.length;
  const nextBlock = content.slice(start).search(/\n\[\[package\]\]/);
  const end = nextBlock === -1 ? content.length : start + nextBlock;
  return { start, end };
}

function readCargoLockVersion(content, label) {
  const { start, end } = lovelaceDesktopBlock(content, label);
  const block = content.slice(start, end);
  const match = block.match(CARGO_VERSION_RE);
  if (!match) fail(`could not find a version line in the lovelace-desktop block of ${label}`);
  return match[1];
}

function writeCargoLockVersion(content, version, label) {
  const { start, end } = lovelaceDesktopBlock(content, label);
  const block = content.slice(start, end);
  if (!CARGO_VERSION_RE.test(block)) {
    fail(`could not find a version line in the lovelace-desktop block of ${label}`);
  }
  const updated = block.replace(CARGO_VERSION_RE, `version = "${version}"`);
  return content.slice(0, start) + updated + content.slice(end);
}

const TS_CONST_RE = /^export const APP_VERSION = '([^']+)';$/m;

function readTsConstVersion(content, label) {
  const match = content.match(TS_CONST_RE);
  if (!match) fail(`could not find the APP_VERSION constant in ${label}`);
  return match[1];
}

function writeTsConstVersion(content, version, label) {
  if (!TS_CONST_RE.test(content)) {
    fail(`could not find the APP_VERSION constant in ${label}`);
  }
  return content.replace(TS_CONST_RE, `export const APP_VERSION = '${version}';`);
}

// Every declaration site, canonical one first. `read` and `write` operate on
// file content strings so trailing newlines are preserved exactly; neither
// ever parses and re-serialises a whole file.
const SITES = [
  { path: 'package.json', read: readJsonTopLevelVersion, write: writeJsonTopLevelVersion },
  { path: 'packages/core/package.json', read: readJsonTopLevelVersion, write: writeJsonTopLevelVersion },
  { path: 'packages/mcp/package.json', read: readJsonTopLevelVersion, write: writeJsonTopLevelVersion },
  { path: 'apps/desktop/package.json', read: readJsonTopLevelVersion, write: writeJsonTopLevelVersion },
  {
    path: 'apps/desktop/src-tauri/tauri.conf.json',
    read: readJsonTopLevelVersion,
    write: writeJsonTopLevelVersion,
  },
  {
    path: 'apps/desktop/src-tauri/Cargo.toml',
    read: readCargoTomlVersion,
    write: writeCargoTomlVersion,
  },
  {
    path: 'apps/desktop/src-tauri/Cargo.lock',
    read: readCargoLockVersion,
    write: writeCargoLockVersion,
  },
  { path: 'packages/mcp/src/version.ts', read: readTsConstVersion, write: writeTsConstVersion },
];

function setVersion(newVersion) {
  if (!SEMVER_RE.test(newVersion)) {
    fail(`"${newVersion}" is not a plain semver version (expected x.y.z, no prerelease)`);
  }
  for (const site of SITES) {
    const filePath = join(REPO_ROOT, site.path);
    const content = readFileSync(filePath, 'utf8');
    const updated = site.write(content, newVersion, site.path);
    if (updated !== content) writeFileSync(filePath, updated);
  }
}

function checkVersion() {
  const [canonical, ...rest] = SITES;
  const canonicalContent = readFileSync(join(REPO_ROOT, canonical.path), 'utf8');
  const expected = canonical.read(canonicalContent, canonical.path);

  const mismatches = [];
  for (const site of rest) {
    const content = readFileSync(join(REPO_ROOT, site.path), 'utf8');
    const actual = site.read(content, site.path);
    if (actual !== expected) mismatches.push({ path: site.path, expected, actual });
  }

  if (mismatches.length > 0) {
    for (const { path, expected: exp, actual } of mismatches) {
      console.error(`sync-version: ${path}: expected ${exp}, found ${actual}`);
    }
    process.exit(1);
  }
}

function main() {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'set') {
    if (!arg) fail('usage: sync-version.mjs set <x.y.z>');
    setVersion(arg);
  } else if (mode === 'check') {
    checkVersion();
  } else {
    fail('usage: sync-version.mjs <set <x.y.z>|check>');
  }
}

main();
