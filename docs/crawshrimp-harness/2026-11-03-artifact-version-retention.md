# Document versions, cache retention and quota recovery

Continues commit 7710752e7 (Office process-image exclusion and compact-row fix).

## Behavior

- Office process-image events are excluded again at the durable snapshot boundary; ordinary images explicitly presented through the artifact tool remain deliveries.
- Unchanged content within one document reuses the same immutable version, even across Office run/render job copies and when quota is full. Different documents with identical content keep separate identities but share one private copy within their session. Other sessions remain isolated.
- One Office document occupies one inventory row; its history lists unique content versions. An unsaved newest file remains the row with an explicit warning; previous ready versions are accessible below it.
- Managed Office drafts retain the ten most recently registered distinct content versions. Final deliveries, uploads and unknown publishers are protected. Protection is monotonic. The policy applies only to snapshot copies, never document originals.
- Expired receipts become persistent tombstones. History labels them “版本已清理”, disables opening, and chunk/history endpoints return HTTP 410. A later explicit final delivery can restore an unchanged formerly pruned draft; ordinary polling cannot resurrect it.
- Quota forecasts the oldest draft copies that a successful new version would retire. Old drafts are not evicted before the new copy succeeds. Shared copies are removed only after their last surviving reference is retired.
- Completed Office job process images/preview PDFs expire after seven days (also requiring the file itself to be seven days old). Live jobs, sessions with active runs, explicit image deliveries, uploads and document files are preserved. Standalone Office preview caches follow the same TTL. Missing previews are regenerated from the retained document when reopened.
- Maintenance runs about one minute after backend startup, then hourly, using the existing owner-only backend maintenance loop. Legacy receipt policies are populated from durable events without rewriting those events.
- At 80% of either quota, resource inventory shows usage. Limits remain 512 MiB / 500 private copies per session and 64 MiB per file.
- Full/oversize warnings explicitly state that the file was generated but no historical copy was saved. “打开当前原文件” remains a deliberate action. “清理空间后重试保存” retires disposable legacy process-image snapshots and excess drafts in that session, then retries the exact registered source identity. Source replacements/symlinks are rejected; protected copies are not sacrificed to make room. If quota is still full, the UI says so without claiming task generation failed.

## Validation

- 134 targeted Python tests passed; they cover snapshot integrity, failed commits/copies, concurrent quota/retention, content reuse, protected uploads/finals, shared-copy survival, legacy cleanup/retry, HTTP 410 history, Office runtime and regenerated previews.
- 35 Node resource tests passed; they cover session fences for late retry/history responses and quota refresh.
- Electron smoke covers 1300/900 px layouts, quota warnings, disabled expired history, successful retry and opening a retained history version.
- Vite production build passes; existing bundle-size warning remains.

Run the Python suites with `python -m pytest tests/test_artifact_retention.py tests/test_artifact_snapshots.py tests/test_session_resources.py tests/test_office_artifacts.py tests/test_artifact_delivery.py tests/test_artifact_delivery_versions.py tests/test_task_instance_artifacts.py tests/test_agent_attachment_limits.py tests/test_office_preview.py tests/test_office_runtime.py -q`.
Run Node tests with `node --test app/src/sessionResources.test.js`.
With app Vite on 5187, run `env -u ELECTRON_RUN_AS_NODE app/node_modules/.bin/electron app/scripts/session-resources-layout-smoke.cjs`.

This is a local implementation. No installed client was replaced and no production/user snapshot store was cleaned during development.
