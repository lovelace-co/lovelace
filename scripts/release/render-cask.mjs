#!/usr/bin/env node
/**
 * Renders the Homebrew cask for the Lovelace desktop app as plain text.
 * Plain Node, no dependencies, so it runs the same way on every CI runner.
 * Pure: takes a version and the two macOS DMG sha256s and prints the cask's
 * Ruby source to stdout. The homebrew-cask.yml workflow is the only caller;
 * it writes the output straight into Casks/lovelace.rb in the tap repo.
 *
 * Usage:
 *   node scripts/release/render-cask.mjs <version> <arm64_sha256> <x64_sha256>
 */

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function fail(message) {
  console.error(`render-cask: ${message}`);
  process.exit(1);
}

// The leftover paths a real install leaves behind on macOS, alphabetical so
// a diff against the previous cask never reorders them. `zap` tolerates
// paths that are absent.
const ZAP_TRASH = [
  '~/Library/Application Support/co.lovelace.desktop',
  '~/Library/Caches/co.lovelace.desktop',
  '~/Library/Preferences/co.lovelace.desktop.plist',
  '~/Library/Saved Application State/co.lovelace.desktop.savedState',
  '~/Library/WebKit/co.lovelace.desktop',
];

// In the current cask DSL `depends_on macos: :big_sur` means Big Sur or
// newer; Homebrew's own linter rewrites the older ">= :big_sur" comparison
// string to this form (`maximum_macos:` expresses the other direction).
function renderCask(version, armSha256, x64Sha256) {
  const zapLines = ZAP_TRASH.map((path) => `    "${path}",`).join('\n');
  return `cask "lovelace" do
  arch arm: "aarch64", intel: "x64"

  version "${version}"
  sha256 arm:   "${armSha256}",
         intel: "${x64Sha256}"

  url "https://github.com/lovelace-co/lovelace/releases/download/v#{version}/Lovelace_#{version}_#{arch}.dmg"
  name "Lovelace"
  desc "Local-first project management for agent-heavy software development"
  homepage "https://lovelace.co/"

  auto_updates true
  depends_on macos: :big_sur

  app "Lovelace.app"

  zap trash: [
${zapLines}
  ]
end
`;
}

function main() {
  const [version, armSha256, x64Sha256] = process.argv.slice(2);
  if (!version || !armSha256 || !x64Sha256) {
    fail('usage: render-cask.mjs <version> <arm64_sha256> <x64_sha256>');
  }
  if (!VERSION_RE.test(version)) {
    fail(`"${version}" is not a plain semver version (expected x.y.z)`);
  }
  if (!SHA256_RE.test(armSha256)) {
    fail(`arm64 sha256 "${armSha256}" is not 64 hex characters`);
  }
  if (!SHA256_RE.test(x64Sha256)) {
    fail(`x64 sha256 "${x64Sha256}" is not 64 hex characters`);
  }
  process.stdout.write(renderCask(version, armSha256, x64Sha256));
}

main();
