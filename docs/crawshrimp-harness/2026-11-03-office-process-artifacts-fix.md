# Office process images and compact resource layout

Office `publish()` treated every `result.files` entry as a document artifact. Run jobs recursively include PNG files under editable, including `_fit` icons, cropped assets and page previews. Each publication went through the immutable snapshot quota and acquired misleading Office delivery metadata.

The publisher now registers PPTX/DOCX/XLSX/PDF outputs only; render jobs register their reviewed document. Full job files remain available to scripts and render tools. Session resources filter legacy Office working-image events, including failed snapshot events whose path is empty. Explicit final image deliveries and images from other tools remain visible. No stored event, source file or snapshot is deleted.

Compact rows now give filename, metadata, snapshot warning and current-file action separate lines. The explicit current-file action and immutable-history safeguards remain intact.

Validation:
- Python: 86 tests passed across Office artifacts/runtime, session resources, snapshot and artifact delivery tests.
- Node: 33 session-resource behavior tests passed.
- Vite production build passed (existing chunk-size warning).
- Electron/Chromium smoke at 1300 and 900 px: filename width 238 px within a 271 px row, no horizontal overflow, current-file action below file details. Re-run with Vite on 5187 and `env -u ELECTRON_RUN_AS_NODE app/node_modules/.bin/electron app/scripts/session-resources-layout-smoke.cjs`.
- Replay of the provided session log: 573 unique candidate files become 65 document paths; 508 PNG process paths excluded before publication. Existing document revision grouping remains unchanged.

The existing snapshot cap is 512 MiB and 500 versions per session, 64 MiB per file. Filtering old resource events does not reclaim their stored snapshots. The model STREAM_CLOSED failure is outside this fix.
