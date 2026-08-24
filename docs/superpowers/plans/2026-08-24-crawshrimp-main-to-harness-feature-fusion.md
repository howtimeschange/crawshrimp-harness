# Crawshrimp Main to Harness Feature Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the current session. Do not dispatch subagents for this repository.

**Goal:** Selectively migrate the useful functionality added to Crawshrimp `main` after the Harness fork baseline into Crawshrimp Harness without merging unrelated Git histories or overwriting Harness-specific runtime, release, branding, and agent architecture.

**Architecture:** Harness was forked from the source tree at Crawshrimp `b1f77dbf`, but its repository has an independent root commit. Treat upstream changes as a patch catalog, not as a mergeable branch. Apply clean adapter/UI patches in isolated commits; copy final upstream files only when the Harness file is still byte-identical to the fork baseline; manually adapt shared Electron/FastAPI/LLM files around Harness-owned behavior.

**Tech Stack:** Electron 43, Vue 3, Node.js test runner, FastAPI/Python, YAML adapter manifests, Crawshrimp JSRunner adapters, DeepSeek Harness runtime.

## Global Constraints

- Source repository: `/Users/xingyicheng/Documents/crawshrimp`.
- Receiving repository: `/Users/xingyicheng/Documents/crawshrimp-harness`.
- Fork baseline: Crawshrimp `b1f77dbf`.
- Verified upstream remote head: `86bbf14e` (`v2.5.0`).
- Verified upstream local head: `43b8a329`, one commit ahead of the upstream remote.
- Verified Harness starting head: `d04dd2ce`, four commits ahead of Harness `origin/main` at the final inspection point.
- The repositories have no Git merge base. Never run `git merge upstream/main`.
- Preserve the current Harness worktree and its 16 tracked modifications. Perform implementation in an isolated worktree created with `superpowers:using-git-worktrees`.
- Do not import Crawshrimp release commits, package version `2.5.0`, upstream icons, upstream updater feeds, or the upstream `desktop-latest` tag.
- Keep Harness update URLs pinned to `howtimeschange/crawshrimp-harness`; never introduce `updates.crawshrimp.com` into the Harness release path.
- Preserve the current Harness agent, DSH, and cloud backend architecture. Follow Harness `d04dd2ce` for the current cloud-approval entrypoint decision instead of replaying the upstream UI patch.
- Stage exact paths and create one reviewable commit per business capability.
- No push, release, deployment, authenticated write, or production mutation is part of this plan.

---

## Source Delta and Disposition

From `b1f77dbf` to the current Crawshrimp local `main` there are 39 commits affecting 110 paths:

| Capability | Source commits | Disposition |
|---|---|---|
| Script list search | `9a84ac45` | Clean patch; import first |
| TEMU SCM wash attachment fallback | `bf41659f`, `3931ae44` | Clean patch; import first |
| Vipshop PDC persistence | `ff27c873`, `303ffd60`, `bb96e559` | Clean patch; import first |
| Shenhui label tile and compression | `2d86f742`, `d79f4799`, `a393b822` | Clean patch on committed Harness main |
| Bala result/file/material fixes | `803d5c76`, `ab21c41a`, `e606541b`, `f3edf1c4`, `0652c7ee`, `79062e3c` | Partly clean; adapt shared Electron/test files |
| Bala prompt/model changes | `d4216bb8`, `b10ea27b` | Adapt to Harness provider registry; do not overwrite it |
| AI Buyer Show workflow | `ef720c7e`, `514f3733`, `421af140`, `f877dc8a`, `d1e530b4`, `8ce5d016`, `c765fbe5` | Import as a complete cross-layer feature |
| Shenhui shoe rules and failure preservation | `18a2fd8e`, `786f836e`, `8bddee01`, `d3aa220f` | Copy baseline-identical final files; adapt shared API file |
| DeepSeek/provider settings | `dd130dfb`, `d59e8392` | Harness already has a broader provider system; parity audit only |
| Stale AI video restore cleanup | `d59f58d2` | Already present exactly as Harness `57d3b9e5` |
| Cloud approval probing removal | `d1e2c42f` | Equivalent Harness-native change landed as `d04dd2ce`; do not replay |
| App icon | `c6d0ba74` | Reject; Harness owns its branded icon |
| Release commits | `83de5c48`, `243c25da`, `245521f4`, `eac30d98`, `86bbf14e` | Reject; Harness has independent versions/releases |
| Local-only updater refinement | `43b8a329` | Do not cherry-pick; audit only because Harness already has its own changelog modal and release feed |

---

### Task 1: Create an Isolated Integration Worktree

**Files:**

- Inspect only: all currently modified Harness files.
- Create through Git worktree metadata: `codex/crawshrimp-main-feature-fusion`.

**Interfaces:**

- Consumes: Harness commit `0a1a3d48` and fetched `upstream/main`.
- Produces: an isolated clean worktree with the current dirty Harness worktree untouched.

- [ ] **Step 1: Verify source and receiver revisions**

Run:

```bash
git -C /Users/xingyicheng/Documents/crawshrimp-harness fetch --prune origin
git -C /Users/xingyicheng/Documents/crawshrimp-harness fetch --prune upstream main
git -C /Users/xingyicheng/Documents/crawshrimp-harness rev-parse main origin/main upstream/main
git -C /Users/xingyicheng/Documents/crawshrimp-harness status --short --branch
```

Expected: `main` includes `d04dd2ce` or a reviewed successor; `upstream/main` includes `43b8a329` or a reviewed successor; the existing modified files remain listed.

- [ ] **Step 2: Create the worktree using the required skill**

Use `superpowers:using-git-worktrees` and create branch `codex/crawshrimp-main-feature-fusion` from the reviewed Harness `main`. Do not stash, reset, or commit the original worktree's modifications.

- [ ] **Step 3: Record the source boundary in the integration branch**

Add this plan to the integration branch if it is not already present and verify:

```bash
git status --short
git rev-list --count b1f77dbf..upstream/main
```

Expected: the source count is `39` for the inspected boundary; any later count requires re-running the source-delta classification before implementation.

---

### Task 2: Port Script List Search

**Files:**

- Create: `app/src/renderer/utils/scriptSearch.js`
- Create: `app/src/renderer/utils/scriptSearch.test.js`
- Modify: `app/src/renderer/views/ScriptList.vue`
- Modify: `app/src/renderer/utils/scriptFavorites.test.js`

**Interfaces:**

- Consumes: the existing Harness script catalog and favorites view model.
- Produces: normalized title/description/task matching with a visible search control that does not change script execution.

- [ ] **Step 1: Apply the verified clean patch**

```bash
git cherry-pick --no-commit 9a84ac45
git diff --check
```

Expected: no conflicts and no whitespace errors.

- [ ] **Step 2: Run the focused renderer tests**

```bash
cd app
node --test src/renderer/utils/scriptSearch.test.js src/renderer/utils/scriptFavorites.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Commit the isolated capability**

```bash
git add app/src/renderer/utils/scriptSearch.js app/src/renderer/utils/scriptSearch.test.js app/src/renderer/views/ScriptList.vue app/src/renderer/utils/scriptFavorites.test.js
git commit -m "feat(ui): port upstream script list search"
```

---

### Task 3: Port TEMU SCM Detail and PDF Wash Attachment Fallbacks

**Files:**

- Modify: `adapters/temu/manifest.yaml`
- Modify: `adapters/temu/wash-label-create-and-download.js`
- Modify: `tests/temu-wash-label-create-and-download.test.js`
- Modify: `tests/test_temu_manifest.py`

**Interfaces:**

- Consumes: TEMU SCM list/detail attachment data and the existing wash-label row-isolation flow.
- Produces: fallback discovery from SCM detail attachments, including PDF evidence, while preserving valid-row continuation and adapter version `1.5.14`.

- [ ] **Step 1: Apply the two verified clean patches in source order**

```bash
git cherry-pick --no-commit bf41659f 3931ae44
git diff --check
```

Expected: no conflicts.

- [ ] **Step 2: Run adapter and manifest tests**

```bash
node --test tests/temu-wash-label-create-and-download.test.js
./venv/bin/python -m pytest tests/test_temu_manifest.py -q
```

Expected: both commands pass; the manifest test expects `1.5.14`.

- [ ] **Step 3: Commit the TEMU capability**

```bash
git add adapters/temu/manifest.yaml adapters/temu/wash-label-create-and-download.js tests/temu-wash-label-create-and-download.test.js tests/test_temu_manifest.py
git commit -m "fix(temu): port SCM wash attachment fallbacks"
```

---

### Task 4: Port Vipshop PDC Persistence Verification

**Files:**

- Modify: `adapters/vipshop-ops-assistant/vipshop-package-main-image-replace.js`
- Modify: `adapters/vipshop-ops-assistant/manifest.yaml`
- Modify: `tests/vipshop-ops-assistant-package-main-image-replace.test.js`
- Modify: `tests/test_vipshop_ops_manifest.py`

**Interfaces:**

- Consumes: uploaded image URLs, PDC save payloads, and post-save product state.
- Produces: verified marked/package image persistence with adapter version `0.2.4`; UI state alone is not treated as save proof.

- [ ] **Step 1: Apply the verified clean patch sequence**

```bash
git cherry-pick --no-commit ff27c873 303ffd60 bb96e559
git diff --check
```

Expected: no conflicts.

- [ ] **Step 2: Run focused tests**

```bash
node --test tests/vipshop-ops-assistant-package-main-image-replace.test.js
./venv/bin/python -m pytest tests/test_vipshop_ops_manifest.py -q
```

Expected: all tests pass and the manifest expects `0.2.4`.

- [ ] **Step 3: Commit the Vipshop capability**

```bash
git add adapters/vipshop-ops-assistant/vipshop-package-main-image-replace.js adapters/vipshop-ops-assistant/manifest.yaml tests/vipshop-ops-assistant-package-main-image-replace.test.js tests/test_vipshop_ops_manifest.py
git commit -m "fix(vipshop): port verified PDC image persistence"
```

---

### Task 5: Port Shenhui Label Tile, Package Compression, and Shoe Rules

**Files:**

- Create: `adapters/shenhui-new-arrival/batch-label-tile-download.js`
- Create: `adapters/shenhui-new-arrival/assets/shoe-poster-template.jpg`
- Create: `tests/shenhui-new-arrival-batch-label-tile-download.test.js`
- Modify: `adapters/shenhui-new-arrival/manifest.yaml`
- Modify: `adapters/shenhui-new-arrival/assets/shoe-main-image-template-small.jpg`
- Modify: `app/src/renderer/views/TaskRunner.vue`
- Modify: `core/api_server.py`
- Modify: `core/models.py`
- Modify: `core/shenhui_pdf_screenshot.py`
- Modify: `core/shenhui_shoe_packaging.py`
- Modify: `tests/task-center-navigation.test.js`
- Modify: `tests/test_shenhui_new_arrival_packaging.py`
- Modify: `tests/test_shenhui_shoe_packaging.py`

**Interfaces:**

- Consumes: Shenhui cloud folders, PDF screenshots, shoe pose candidates, model chains, and output-package finalization.
- Produces: label tile download/compression, compressed new-arrival packages, current shoe pose rules, compact task parameters, and preservation of completed downloads when later rows fail.

- [ ] **Step 1: Apply the verified clean label/package patches**

```bash
git cherry-pick --no-commit 2d86f742 d79f4799 a393b822
git diff --check
```

Expected: no conflicts on the committed Harness base.

- [ ] **Step 2: Replace only baseline-identical shoe files with the reviewed upstream final versions**

Before replacement, verify each receiver blob still equals `b1f77dbf`:

```bash
git diff --quiet b1f77dbf -- core/shenhui_shoe_packaging.py core/models.py app/src/renderer/views/TaskRunner.vue
```

Expected: exit `0`. Then copy the reviewed upstream final versions:

```bash
git restore --source=upstream/main -- adapters/shenhui-new-arrival/manifest.yaml adapters/shenhui-new-arrival/assets/shoe-main-image-template-small.jpg adapters/shenhui-new-arrival/assets/shoe-poster-template.jpg app/src/renderer/views/TaskRunner.vue core/models.py core/shenhui_shoe_packaging.py tests/task-center-navigation.test.js tests/test_shenhui_new_arrival_packaging.py tests/test_shenhui_shoe_packaging.py
```

- [ ] **Step 3: Adapt only the Shenhui portions of the shared API file**

Use these source commits as the exact change set:

```bash
git show 2d86f742 d79f4799 a393b822 18a2fd8e 8bddee01 d3aa220f -- core/api_server.py
```

Apply the Shenhui task finalization, compression, pose, and failure-preservation hunks to Harness `core/api_server.py`. Preserve all Harness agent, MCP lease, DSH, and security routes.

- [ ] **Step 4: Run focused Shenhui tests**

```bash
node --test tests/shenhui-new-arrival-batch-label-tile-download.test.js tests/task-center-navigation.test.js
./venv/bin/python -m pytest tests/test_shenhui_new_arrival_packaging.py tests/test_shenhui_shoe_packaging.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the Shenhui capability**

```bash
git add adapters/shenhui-new-arrival app/src/renderer/views/TaskRunner.vue core/api_server.py core/models.py core/shenhui_pdf_screenshot.py core/shenhui_shoe_packaging.py tests/shenhui-new-arrival-batch-label-tile-download.test.js tests/task-center-navigation.test.js tests/test_shenhui_new_arrival_packaging.py tests/test_shenhui_shoe_packaging.py
git commit -m "feat(shenhui): port label and shoe package improvements"
```

---

### Task 6: Port Bala Workflow Reliability Without Replacing Harness LLM Routing

**Files:**

- Modify: `adapters/bala-ai-video-assistant/manifest.yaml`
- Modify: `adapters/bala-ai-video-assistant/short-video-batch-upload.js`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/balaAiVideoWorkflow.js`
- Modify: `app/src/renderer/utils/balaAiVideoWorkflow.test.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Modify: `app/src/renderer/views/AiVideoWorkflow.vue`
- Modify: `core/api_server.py`
- Modify: `core/js_runner.py`
- Modify: `core/llm_gateway.py`
- Modify: related Bala, JSRunner, API security, and LLM tests.

**Interfaces:**

- Consumes: Bala task selection, local result paths, browser file inputs, and Harness model routes.
- Produces: refreshed result previews, hardened local deletion, reliable short-video file injection, preserved material selection, prompt writing, and a task-level model default that resolves through the Harness provider registry.

- [ ] **Step 1: Apply the four verified clean patches**

```bash
git cherry-pick --no-commit ab21c41a e606541b 0652c7ee 79062e3c
git diff --check
```

Expected: no conflicts on committed Harness `main`.

- [ ] **Step 2: Port the remaining QN and cleanup behavior manually**

Use:

```bash
git show 803d5c76 f3edf1c4 -- app/src/main.js app/src/renderer/views/AiVideoWorkflow.vue app/src/renderer/utils/balaAiVideoWorkflow.js core/api_server.py tests/bala-ai-video-workflow-ui.test.js tests/test_file_delete_security.py
```

Keep Harness main-process startup and DSH supervision intact. The QN adapter script and its focused test are already byte-identical to upstream and must not be replaced.

- [ ] **Step 3: Adapt prompt writing and video-copy model selection**

Use `d4216bb8` and `b10ea27b` as behavior references. Add the prompt-writing endpoint and renderer bridge, but route the selected model through the existing Harness `BUILTIN_LLM_PROVIDERS`/custom-provider registry. Do not replace `core/llm_gateway.py`, `core/config.py`, `llmSettings.mjs`, or `SettingsPage.vue` with upstream versions.

- [ ] **Step 4: Run focused Bala and gateway tests**

```bash
node --test tests/bala-ai-video-assistant-qn-img2video.test.js tests/bala-ai-video-assistant-short-video-upload.test.js tests/bala-ai-video-workflow-ui.test.js
./venv/bin/python -m pytest tests/test_ai_video_generation_api.py tests/test_ai_video_generation_security_api.py tests/test_bala_ai_video_materials.py tests/test_file_delete_security.py tests/test_js_runner.py tests/test_llm_gateway.py -q
```

Expected: all tests pass and no Harness custom-provider test regresses.

- [ ] **Step 5: Commit the Bala capability**

Stage only the files changed for this task and commit:

```bash
git commit -m "fix(bala-video): port upstream workflow reliability"
```

---

### Task 7: Add the AI Buyer Show Workflow as a Harness-Native Feature

**Files:**

- Create: `adapters/semir-cloud-drive/buyer-show-ai-generate.js`
- Create: `adapters/semir-cloud-drive/templates/buyer-show-ai-template.csv`
- Create: `app/src/renderer/views/BuyerShowWorkflow.vue`
- Create: `app/src/renderer/utils/buyerShowWorkflow.test.js`
- Create: `core/buyer_show_service.py`
- Create: `tests/semir-cloud-drive-buyer-show-ai-generate.test.js`
- Create: `tests/test_buyer_show_service.py`
- Modify: `adapters/semir-cloud-drive/manifest.yaml`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/App.vue`
- Modify: `app/src/renderer/utils/aiImageTaskIsolation.js`
- Modify: `app/src/renderer/utils/aiImageTaskIsolation.test.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Modify: `core/ai_image_service.py`
- Modify: `core/api_server.py`
- Modify: `core/data_sink.py`
- Modify: Buyer Show, AI image, data lifecycle, manifest, and navigation tests.

**Interfaces:**

- Consumes: task ID `buyer_show_ai_generate`, Semir cloud material matching, Excel rows, AI image job execution, data-sink run history, and the existing `window.cs` task/file bridge.
- Produces: a dedicated Harness navigation page with Excel preview, match/download/generation progress, bounded generation concurrency, resume/recovery, output packaging, and a local result-history queue.

- [ ] **Step 1: Copy the final upstream-only feature files**

```bash
git restore --source=upstream/main -- adapters/semir-cloud-drive/buyer-show-ai-generate.js adapters/semir-cloud-drive/templates/buyer-show-ai-template.csv app/src/renderer/views/BuyerShowWorkflow.vue app/src/renderer/utils/buyerShowWorkflow.test.js core/buyer_show_service.py tests/semir-cloud-drive-buyer-show-ai-generate.test.js tests/test_buyer_show_service.py
```

- [ ] **Step 2: Add the final task contract to the Semir manifest**

Port only the `buyer_show_ai_generate` task block and its template reference from `upstream/main:adapters/semir-cloud-drive/manifest.yaml`. Set the Harness adapter version to upstream `0.1.4` and preserve all Harness-owned task entries.

- [ ] **Step 3: Wire the Harness page without replacing its shell**

In `app/src/renderer/App.vue`, add:

- `BuyerShowWorkflow` import;
- `buyer_show_workflow` to the AI-workflow layout condition;
- a `KeepAlive` view next to the existing AI image/video workbenches;
- an AI workflow navigation entry compatible with the Harness sidebar.

Preserve `currentView === 'agent'`, `AgentWebView`, the navigation state from Harness `d04dd2ce`, agent script review, and the Harness product-event overlay.

- [ ] **Step 4: Port backend and data contracts by symbol**

Port the exact Buyer Show symbols from upstream rather than replacing full files:

```bash
git diff b1f77dbf..upstream/main -- core/ai_image_service.py core/api_server.py core/data_sink.py app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js app/src/renderer/utils/aiImageTaskIsolation.js
```

Required behavior:

- register `("semir-cloud-drive", "buyer_show_ai_generate")` finalization;
- call `buyer_show_service.finalize_buyer_show_outputs`;
- persist and query buyer-show material usage and AI-image job history;
- allow `getData(aid, tid, { limit: 0 })` through main, preload, and dev bridges;
- hide Buyer Show AI image jobs from the general AI image workbench;
- preserve Harness API security, agent APIs, DSH leases, and current image-generation option routing.

- [ ] **Step 5: Run Buyer Show-focused tests**

```bash
node --test tests/semir-cloud-drive-buyer-show-ai-generate.test.js app/src/renderer/utils/buyerShowWorkflow.test.js tests/ai-image-workbench-navigation.test.js tests/desktop-backend-startup.test.js
./venv/bin/python -m pytest tests/test_buyer_show_service.py tests/test_ai_image_service.py tests/test_data_sink_lifecycle.py tests/test_semir_cloud_drive_manifest.py -q
```

Expected: all tests pass.

- [ ] **Step 6: Perform bounded real validation**

Use the current authenticated runtime only after tests pass:

1. Run `download_only` with one valid Excel row and verify matched files plus result history.
2. Run `generate` with `max_generate_jobs=1` and bounded concurrency.
3. Read back the task status, output directory, result workbook, generated image signature/dimensions, and local history queue.
4. Confirm a failed row does not erase successful output or abort unrelated rows.

- [ ] **Step 7: Commit the Buyer Show capability**

Stage only the files listed in this task and commit:

```bash
git commit -m "feat(buyer-show): add Harness-native AI workflow"
```

---

### Task 8: Audit Platform-Owned Features and Explicitly Reject Unsafe Imports

**Files:**

- Inspect: `.github/workflows/build-desktop.yml`
- Inspect: `app/src/updateInstallCoordinator.js`
- Inspect: `app/src/updateService.js`
- Inspect: `app/src/renderer/components/UpdateChangelogModal.vue`
- Inspect: `app/src/renderer/views/SettingsPage.vue`
- Inspect: `app/src/renderer/utils/llmSettings.mjs`
- Inspect: `core/config.py`
- Inspect: `core/llm_gateway.py`

**Interfaces:**

- Consumes: upstream behaviors from `dd130dfb`, `d59e8392`, `d1e2c42f`, and local-only `43b8a329`.
- Produces: a parity checklist proving which behavior Harness already supersedes and which small behavior still needs a Harness-native patch.

- [ ] **Step 1: Verify DeepSeek/provider parity**

Confirm Harness retains official DeepSeek IDs, gateway IDs, custom providers, masked credential handling, and model routing. Add only missing task-specific model aliases/defaults discovered by Tasks 6 and 7; do not cherry-pick `dd130dfb` or `d59e8392`.

- [ ] **Step 2: Verify updater parity**

Confirm Harness already has `UpdateChangelogModal`, `fetchLatestReleaseNotes`, its own GitHub release page, and task-safe install coordination. Do not import Crawshrimp Cloudflare metadata publication or `bypassReadiness: true` without a separate Harness product decision and regression plan.

- [ ] **Step 3: Preserve Harness-only product surfaces**

Do not apply `d1e2c42f`; its relevant entrypoint behavior is already represented by Harness `d04dd2ce`, while Harness retains its own backend architecture. Do not import Crawshrimp icons, version numbers, release notes, release workflow mutations, or rolling tags.

- [ ] **Step 4: Record the disposition in the final fusion commit or handoff**

The handoff must list every rejected commit category and the reason, so future upstream audits do not repeatedly attempt the same unsafe imports.

---

### Task 9: Full Validation and Integration into Harness Main

**Files:**

- Test: all changed adapter, Electron, renderer, FastAPI, data, LLM, and packaging files.
- Modify: no new product files beyond Tasks 2-8.

**Interfaces:**

- Consumes: all feature commits from this plan.
- Produces: a rebased, reviewable Harness integration branch with generated-artifact and runtime evidence.

- [ ] **Step 1: Run complete static and focused gates**

```bash
git diff --check
cd app && npm test && npm run vite:build
cd .. && node --test tests/*.test.js
./venv/bin/python -m pytest -q
```

Expected: all commands end successfully. Record actual totals; do not infer them from older runs.

- [ ] **Step 2: Verify packaged-runtime staging**

```bash
cd app
npm run stage:harness
node --test scripts/after-pack.test.js
```

Expected: required adapters, skills, DSH runtime, and Python runtime checks pass without upstream Crawshrimp release assets leaking into Harness.

- [ ] **Step 3: Reconcile the original dirty Harness work**

After the owner has committed or otherwise resolved the pre-existing 16 modified files, rebase the fusion branch onto the resulting Harness `main`. Resolve by preserving Harness implementations in:

- `app/src/renderer/utils/llmSettings.mjs`
- `app/src/renderer/views/SettingsPage.vue`
- `core/api_server.py`
- `core/config.py`
- `core/llm_gateway.py`
- Harness agent/DSH integration files.

Then rerun all gates from Steps 1-2.

- [ ] **Step 4: Merge locally only after readback**

Verify:

```bash
git status --short --branch
git log --oneline --decorate -n 20
git diff main...codex/crawshrimp-main-feature-fusion --stat
```

Expected: only reviewed fusion commits are present; no push or release follows unless separately requested.

---

## Self-Review Results

- Spec coverage: all 39 inspected source commits are assigned to import, adapt, already-present, or reject categories.
- Placeholder scan: the plan contains no deferred implementation placeholders; all source commits, files, commands, and expected gates are named.
- Interface consistency: Buyer Show uses `buyer_show_ai_generate` consistently; data history uses `getData(aid, tid, { limit: 0 })`; Harness LLM routing remains the authoritative provider interface.
- Safety: the plan never merges unrelated histories, never overwrites the dirty worktree, and never imports original-app release or branding state.
