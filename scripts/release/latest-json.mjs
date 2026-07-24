#!/usr/bin/env node
/**
 * Assembles latest.json from the artifacts a release build produced.
 * Plain Node, no dependencies, so it runs the same way on every CI runner.
 *
 * Usage:
 *   node scripts/release/latest-json.mjs --version 0.2.0 \
 *     --base-url https://github.com/lovelace-co/lovelace/releases/download/v0.2.0 \
 *     --dir path/to/downloaded/artifacts \
 *     --notes "What changed, in one paragraph."
 *
 * --notes is optional; when omitted the manifest carries no notes field.
 * The staged-publishing step may also add or edit notes by hand before
 * promotion, since the staged latest.json is committed to the website
 * repository either way.
 *
 * Reads every updater artifact and its .sig file out of --dir (one flat
 * directory holding all four platforms' files), and writes
 * <dir>/latest.json. A platform with a missing artifact or .sig is a hard
 * error naming what was found, since a broken latest.json breaks the
 * updater silently for every install.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One platform key per updater target. `suffix` identifies that platform's
// updater artifact among the files in --dir; the signature file is that
// filename plus `.sig`. These suffixes are the real filenames Tauri 2
// produces (see docs/RELEASING.md), not a guess.
const PLATFORMS = [
  { key: 'darwin-aarch64', suffix: '_aarch64.app.tar.gz' },
  { key: 'darwin-x86_64', suffix: '_x64.app.tar.gz' },
  { key: 'windows-x86_64', suffix: '-setup.exe' },
  { key: 'linux-x86_64', suffix: '.AppImage' },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`latest-json: ${message}`);
  process.exit(1);
}

function rfc3339Now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const baseUrl = args['base-url'];
  const dir = args.dir;
  if (!version) fail('--version is required');
  if (!baseUrl) fail('--base-url is required');
  if (!dir) fail('--dir is required');

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const platforms = {};
  for (const { key, suffix } of PLATFORMS) {
    const matches = entries.filter((name) => name.endsWith(suffix) && !name.endsWith('.sig'));
    if (matches.length === 0) {
      fail(
        `no updater artifact for ${key} (looked for a file ending in "${suffix}" in ${dir}). ` +
          `found: ${entries.length ? entries.join(', ') : '(nothing)'}`,
      );
    }
    if (matches.length > 1) {
      fail(`more than one updater artifact for ${key} in ${dir}: ${matches.join(', ')}`);
    }
    const [filename] = matches;
    const sigName = `${filename}.sig`;
    if (!entries.includes(sigName)) {
      fail(
        `missing signature for ${key} (expected "${sigName}" next to "${filename}" in ${dir}). ` +
          `found: ${entries.join(', ')}`,
      );
    }
    const signature = readFileSync(join(dir, sigName), 'utf8').trim();
    platforms[key] = {
      signature,
      url: `${baseUrl}/${filename}`,
    };
  }

  const manifest = {
    version,
    ...(args.notes ? { notes: args.notes } : {}),
    pub_date: rfc3339Now(),
    platforms: Object.fromEntries(Object.keys(platforms).sort().map((key) => [key, platforms[key]])),
  };

  const outPath = join(dir, 'latest.json');
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}

main();
