# Script marketplace lifecycle

Implementation prepared 2026-09-11. **Migrations 004/005 applied online 2026-09-11 via authenticated Supabase MCP.** Receipts: 20260911111624 (004_lifecycle), 20260911111633 (005_version_reviews). Verified both columns, tables, RLS, lifecycle constraints/indexes/trigger and all 9 function bodies. Existing 9 packages and 0 ratings preserved with unchanged original-data hashes; legacy association remains owner ZIP-driven. Admin UI changes are local in the separate `cloud/harness-analytics` repository; not deployed this turn.

## Rules

- Identity: `(owner_id, manifest.id)` in `market_scripts`; immutable `(script_id, version)` releases in `market_packages`.
- Same ZIP and version return the existing record. Different content under an existing version must increment `manifest.version`.
- Legacy records link only when the owner prepares the exact existing ZIP (same SHA-256 and version).
- Draft → pending → approved/rejected. Owner can cancel draft/pending and unlist approved. Unlisting also cancels pending updates for that script. Canceled/rejected/self-withdrawn releases can be resubmitted for review; admin-withdrawn releases require a corrected new version.
- Pending updates leave the current approved release available. Approval locks the script, checks SemVer precedence, and atomically moves the old approved release to superseded. Only one release per script is approved.
- Historical package metadata and comments stay visible while the script has an approved release. Historical ZIP downloads are owner/admin only. Ratings count each user's most recent eligible version rating once.
- Local manual imports with the same manifest ID are atomically replaced through the existing adapter installer. Newer local versions and another marketplace publisher's receipts are protected. Successful installs are read back before saving receipts.
- Owner/admin state changes append immutable events. Clients cannot update package rows or overwrite ZIP objects.

## Agent entry point

`integrations/deepseek-harness/skills/crawshrimp-market/SKILL.md` and `scripts/market.cjs` ship with the runtime. The Electron main process starts a loopback market bridge before spawning the backend; its random process capability is inherited by the managed runtime. Supabase credentials stay in Electron. The bridge accepts only list/history/prepare/publish/submit/cancel/unlist/discard; no review action.

Use the existing logged-in account; CLI preparation is local and does not upload. Publish and lifecycle actions require corresponding user intent. Failed or uncertain mutation receipts must be read back before retrying.

## Validation and rollout remaining

Passed local Postgres lifecycle/RLS tests, desktop service and bridge tests, Vue production build. Real Electron + encrypted logged-in account + actual CLI + real Python installer passed with supplied 上新运营助手-v2.0.1.zip: preparation, authenticated list, exact cloud package hash match, overwrite of a preexisting manual import in isolated data, duplicate-install skip. No operational adapter task was executed and no production record was mutated.

Example is already approved as `上线流程`, package `f6e42495-8f28-42d2-9580-eb047e2fa754`, manifest ID `ai-mopai-fentu`, version `2.0.1`, SHA-256 `e99caaf9d59e7332ceb419cd592739723230d334b973b8b552a3191180e508d3`. Republishing the exact original ZIP after migration must return/link that record, not create another listing.

Remaining: deploy the admin update; perform a real agent conversation using the shipped skill, prepare/publish the existing example and verify idempotent original record readback; exercise submit/review/version transition using a harmless uniquely identified QA script, then withdraw QA. Do not mutate the user's approved example merely for testing. Version modal fixture acceptance completed; combined detail/review UI and parallel read loading added. Source client restarted with updated main process on 2026-09-11. Clean stage-runtime --force completed with Web profile config check OK; both market SKILL.md and market.cjs were verified in darwin-arm64 staging. No Git commit, push or desktop release was performed. Installed release was not restarted.
