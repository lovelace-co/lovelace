# Releasing Lovelace

How a release is produced, signed and shipped to the website. The build
itself is one command; everything requiring accounts or certificates is
marked **manual** below.

## Build

```sh
pnpm install
pnpm build                              # type-checks every package
pnpm test                               # full suite must be green
./apps/desktop/scripts/prepare-sidecars.sh   # compiles and stages the Bun sidecars
cd apps/desktop && pnpm exec tauri build
```

`tauri build` bundles the frontend, compiles the Rust shell in release
mode, embeds the three sidecars (`lovelace-host`, `lovelace-agent`,
`lovelace-mcp`) next to the app binary, and produces platform installers
under `apps/desktop/src-tauri/target/release/bundle/`.

Per platform this must run on a machine (or CI runner) of that platform:
macOS produces `.app` and `.dmg`, Windows `.msi` and `.exe` (NSIS), Linux
`.deb`, `.rpm` and `.AppImage`.

On a headless macOS runner Tauri's DMG step fails because its
`bundle_dmg.sh` styles the volume through Finder AppleScript. Build with
`--bundles app` there and create the DMG directly:

```sh
mkdir dmg-stage && cp -R bundle/macos/Lovelace.app dmg-stage/
ln -s /Applications dmg-stage/Applications
hdiutil create -volname "Lovelace" -srcfolder dmg-stage -ov -format UDZO \
  bundle/dmg/Lovelace_<version>_aarch64.dmg
```

## Update artifacts

`createUpdaterArtifacts` is on, so the build also emits compressed update
packages and `.sig` files. Signing them needs the updater private key:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH=/path/to/.tauri-updater.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

The matching public key is committed in `tauri.conf.json`. The private key
(`.tauri-updater.key`, gitignored) must live only in CI secrets and a
password manager. **Manual:** if the key is ever lost or leaked, generate a
new pair with `pnpm exec tauri signer generate`, update `pubkey` in
tauri.conf.json, and ship one final old-key release whose only change is
the new key, or auto-update breaks for existing installs.

## Code signing (manual)

Without these steps installers work but show OS security warnings.

- **macOS:** an Apple Developer ID Application certificate. Set
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  and for notarisation `APPLE_ID`, `APPLE_PASSWORD` (app-specific) and
  `APPLE_TEAM_ID` in the build environment. Tauri signs and notarises
  automatically when they are present.
- **Windows:** a code-signing certificate (EV recommended). Set
  `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`, or configure
  `bundle.windows.signCommand` for a cloud signer (Azure Trusted Signing).
- **Linux:** no signing required for v1.

## Publishing to the website (manual)

1. Upload the installers to the downloads page.
2. Upload each platform's update package and `.sig`.
3. Update `https://lovelace.app/releases/latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "What changed, in one paragraph.",
  "pub_date": "2026-07-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of the .sig file>",
      "url": "https://lovelace.app/releases/Lovelace_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { "signature": "...", "url": "..." },
    "windows-x86_64": { "signature": "...", "url": "..." },
    "linux-x86_64": { "signature": "...", "url": "..." }
  }
}
```

The app checks this endpoint on launch (release builds only) and installs
updates silently. No telemetry: the update check is the only network call
the app ever makes.

## Version bumps

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` and the root
`package.json` together. The updater compares against the running version,
so a release without a bump will never be offered.
