# Releasing Lovelace

How a release is produced, signed and shipped to the website. Pushing a
`v*` tag runs `.github/workflows/release.yml`, which does the build below
on all four platforms, signs the updater packages, and stages everything
on a draft GitHub Release. Everything requiring accounts or certificates
is marked **manual** below.

## Build

The workflow runs this same sequence per platform (macOS aarch64, macOS
x86_64 cross-compiled, Windows x86_64, Linux x86_64), compiling the
sidecars fresh in every job so a release can never ship stale ones. To
build a single platform by hand:

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
under `apps/desktop/src-tauri/target/release/bundle/`. To build for a
platform other than the machine you are on, pass the Rust target triple
as `./apps/desktop/scripts/prepare-sidecars.sh <triple>` and
`tauri build --target <triple>`; see the workflow for the triples in use.

Per platform this must run on a machine (or CI runner) of that platform:
macOS produces `.app` and `.dmg`, Windows `.msi` and `.exe` (NSIS), Linux
`.deb`, `.rpm` and `.AppImage`.

On a headless macOS runner Tauri's DMG step fails because its
`bundle_dmg.sh` styles the volume through Finder AppleScript. Build with
`--bundles app` there and create the DMG directly (the workflow does
exactly this):

```sh
mkdir dmg-stage && cp -R bundle/macos/Lovelace.app dmg-stage/
ln -s /Applications dmg-stage/Applications
hdiutil create -volname "Lovelace" -srcfolder dmg-stage -ov -format UDZO \
  bundle/dmg/Lovelace_<version>_aarch64.dmg
```

## Update artifacts

`createUpdaterArtifacts` is on, so the build also emits compressed update
packages and `.sig` files. In the workflow, signing key material comes
from the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
repository secrets; the run fails fast if the key secret is not set,
rather than shipping an unsigned release. `scripts/release/latest-json.mjs`
then assembles `latest.json` mechanically from the signed artifacts each
platform job produced. To sign a build by hand instead:

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
3. Update `https://lovelace.co/releases/latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "What changed, in one paragraph.",
  "pub_date": "2026-07-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of the .sig file>",
      "url": "https://lovelace.co/releases/Lovelace_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { "signature": "...", "url": "..." },
    "windows-x86_64": { "signature": "...", "url": "..." },
    "linux-x86_64": { "signature": "...", "url": "..." }
  }
}
```

The app checks this endpoint on launch and every 24 hours after that
(release builds only), downloads an available update in the background,
and shows a quiet "Update ready" affordance in the tab strip; nothing
installs until the user chooses to restart. The `notes` value, when
present, travels with that offer. Lovelace menu, Check for Updates runs
the same check on demand. No telemetry: the update check is the only
network call the app ever makes.

## Verifying the update flow by hand

The whole flow can be exercised locally, no website or CI involved.
`LOVELACE_UPDATE_ENDPOINT` points any build at another feed; signature
verification against the committed pubkey still applies, and a debug
build also accepts a plain `http://` endpoint (a release build requires
`https://`).

1. In a second checkout, bump `version` in
   `apps/desktop/src-tauri/tauri.conf.json` and the root `package.json`
   to something above the running version, for example `9.9.9`.
2. Build the update artifact there with the signing key:

   ```sh
   export TAURI_SIGNING_PRIVATE_KEY_PATH=/path/to/.tauri-updater.key
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   cd apps/desktop && pnpm exec tauri build --bundles app
   ```

   This produces `Lovelace.app.tar.gz` and its `.sig` under
   `src-tauri/target/release/bundle/macos/`.
3. Put both in a scratch directory as
   `Lovelace_9.9.9_aarch64.app.tar.gz` (plus `.sig`), write a
   `latest.json` beside them naming that version and URL (the format
   above; `signature` is the `.sig` contents), and serve it:

   ```sh
   python3 -m http.server 8787 --directory /path/to/that/directory
   ```

4. Run the old build pointed at the local feed:

   ```sh
   LOVELACE_UPDATE_ENDPOINT=http://127.0.0.1:8787/latest.json pnpm app:dev
   ```

   Within a few seconds the "Update ready" capsule appears in the tab
   strip, left of the theme toggle. Clicking it shows "Restarting…",
   installs, and relaunches on the new version (on Windows the
   installer itself relaunches the app).
5. Manual-check path: point the feed at a version at or below the
   running one and choose Lovelace menu, Check for Updates. A native
   dialog reports "Lovelace <version> is up to date."; an unreachable
   feed reports the failure. Background checks stay silent on both
   outcomes.

## Version bumps

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` and the root
`package.json` together. The updater compares against the running version,
so a release without a bump will never be offered.
