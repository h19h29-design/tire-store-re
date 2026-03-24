# Release Process

This repository publishes the Windows NSIS installer to GitHub Releases.

## What the workflow does

- Triggers when a tag matching `v*` is pushed.
- Verifies the app version matches in:
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- Verifies the pushed tag matches the app version (for example `v1.46.1`).
- Builds the Windows NSIS installer with Tauri.
- Creates or updates the GitHub Release for that tag and uploads the installer asset.

## Release steps

1. Update the version in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. Verify the versions locally:

   ```bash
   npm run release:check-version
   ```

3. Commit and push the version change.
4. Create and push the release tag:

   ```bash
   git tag v1.46.1
   git push origin main
   git push origin v1.46.1
   ```

5. Wait for the `Release` GitHub Actions workflow to finish.
6. Download the installer from the GitHub Release assets.

## Notes

- The workflow currently publishes the Windows NSIS installer only.
- Builds are unsigned. Windows SmartScreen may warn until code signing is configured.
- The workflow uses the repository `GITHUB_TOKEN`; no extra release secret is required for the same repository.
