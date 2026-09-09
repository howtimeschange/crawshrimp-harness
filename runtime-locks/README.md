# Office runtime delivery

The Office tools share the application's Python 3.12.13. Direct additions are
python-docx 1.2.0, python-pptx 1.0.2, pandas 3.0.5, and matplotlib 3.11.1.
openpyxl, xlrd, Pillow and PyMuPDF remain the existing Excel/image/PDF engines.
XlsxWriter is an upstream python-pptx dependency, not a second spreadsheet workflow.

`python/*-py312.txt` lock the combined backend and Office closure, including wheel
hashes. Their headers record the uv resolution commands. Windows also includes
`core/requirements-win.txt`. Regenerate and validate all three locks together when
changing dependency declarations. Never install packages during an Office task.

Build preparation (from the repository root; select an explicit build Python):

```sh
"$CRAWSHRIMP_PYTHON_EXECUTABLE" app/scripts/prepare-python-wheels.py mac-arm64
PYTHON_TARGETS=mac-arm64 bash app/scripts/download-python.sh
node app/scripts/stage-office-runtime.mjs mac-arm64
node integrations/deepseek-harness/scripts/stage-runtime-targets.mjs darwin-arm64
```

Use mac-x64/darwin-x64 or win-x64/win32-x64 for the other targets. Windows staging
requires Windows (`msiexec /a` extracts its official MSI). Python installation
consumes the downloaded wheelhouse offline with `--require-hashes --no-index`.
The build scripts may bootstrap their build interpreter; runtime tools always
use `CRAWSHRIMP_PYTHON_EXECUTABLE`, never PATH Python or pip.

`office-assets.json` pins LibreOffice 26.2.6 and Source Han Sans/Serif SC fonts.
Archives and fonts are verified before extraction. Keep the complete LibreOffice
layout and its upstream notices; font OFL notices are copied from `licenses/`.
Office documents use 思源黑体/思源宋体 family names; matplotlib registers the
bundled font files using `core.office.runtime.configure_fonts()`.

`afterPack` verifies source hashes, Python lock identity, both font copies, and
then runs the copied target Python against the copied Office resources. Its
`office-smoke-<target>-<timestamp>/report.json` (beside the app) records real
generation, reopening, Chinese PDF fonts and page counts (3/5/3). XLSX checks
include the text ID `00123`, total 69 and IF result 有销售. Failure blocks the
build. A host unable to execute its target cannot pass through static checks.
Executable hashes apply before signing; signing changes native executable bytes,
so runtime diagnostics verify immutable font data and executable presence rather
than comparing signed binaries with their pre-signing byte hashes.

Manual native gate, with the runtime paths explicitly supplied:

```sh
"$CRAWSHRIMP_PYTHON_EXECUTABLE" core/office/cli.py smoke /absolute/new-output-dir
```

This checks execution and data, not visual review. Actual Agent testing must read
every page using `office_preview_read`, record observations against its revision
and page hash, and exercise the desktop resource preview. Reports distinguish
unreviewed, partial, issues and passed. Files reside in the session workspace's
`outputs/office/<session-hash>/<job-id>/`; originals are never overwritten.

Current evidence and remaining platform checks are tracked in
`docs/superpowers/specs/2026-09-09-office-suite-runtime-design.md`. ARM execution
does not establish Intel/Windows or signed installer acceptance.
