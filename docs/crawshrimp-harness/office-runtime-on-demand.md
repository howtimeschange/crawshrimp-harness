# Office Runtime On Demand

Harness desktop builds ship the Office generation feature without embedding the
full native LibreOffice runtime by default. The installer includes the locked
metadata in `runtime-locks/office-assets.json` and the matching license notices;
the native runtime is downloaded into the user data cache the first time an
Office workflow needs it.

## Default Build

The default CI and local desktop builds are lightweight. They do not stage or
copy native Office assets into the application. Existing local staging caches
may remain on disk and are ignored by lightweight packaging.

The build still includes:

- `runtime-locks/office-assets.json`
- `runtime-locks/licenses/`
- the Python Office CLI and generation code

At runtime, the installer verifies every downloaded asset against the lock file
SHA-256 before publishing the cache entry. Once cached, future Office runs can
work offline as long as the same lock fingerprint is still current.

## Full Offline Build

Set `CRAWSHRIMP_BUNDLE_OFFICE=1` when a release must include the full native
Office runtime. Windows runs the Office smoke during packaging; macOS runs it
after signing so its font resources have a valid resource seal.

```bash
CRAWSHRIMP_BUNDLE_OFFICE=1 npm --prefix app run build:mac:ci
CRAWSHRIMP_BUNDLE_OFFICE=1 npm --prefix app run build:win
```

In GitHub Actions, set the repository or environment variable
`CRAWSHRIMP_BUNDLE_OFFICE` to `1` before running the desktop build workflow.
When the variable is unset, CI verifies only the lightweight lock metadata and
skips native Office staging.

## Maintenance Checks

- Keep `runtime-locks/office-assets.json` and `runtime-locks/licenses/` in the
  source tree.
- Do not commit `build-staging/office` payloads.
- Update the lock file whenever the LibreOffice installer, font assets, or
  supported target list changes.
- Run a full offline build with `CRAWSHRIMP_BUNDLE_OFFICE=1` before relying on
  packaged native Office assets.
