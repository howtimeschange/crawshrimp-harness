# DSH rc.2 ModelJetty and embedded UI verification

Date: 2026-10-22. Branch: codex/v0.5.0. Local development only; no push/release.

## Findings and fixes

- Real failing UI showed AUTH / API 密钥无效. The local broker credential matched the running worker. A diagnostic response returned HTTP 403 with `insufficient_user_quota` and zero upstream user balance. rc.2 classified any 401/403 as AUTH before checking quota, and its quota matcher missed `insufficient_user_quota`. C04 fixes both conditions while preserving ordinary authentication and rate-limit classifications.
- rc.2 replaced the old turnStatus markup with a data-chat-running component and separate accessible/live elapsed copy. C05 updates its localized running strings to 抓虾中 and preserves duration, rather than relying on the obsolete DOM detector.
- Chat, skills, subagents, references and scheduling require sidebarRight services. Disabling that plugin caused a visible boot failure during validation. The final approach retains those services; C06 suppresses only embedded RightbarRoot and ExpandButton. Standalone rendering remains intact. The product profile disables the duplicated Open In UI. C07 suppresses the embedded session-export ellipsis while preserving export backend and Harness export control.
- Profile overrides precede the generated preset declaration, so staging does not erase them.

## Real desktop validation

Operated the actual Electron app through native UI controls, with Vite 5177 / API 18815 and the isolated v050 data/profile.

1. After owner-authorized Pro grant and CNY 360 test credit, selected managed-deepseek-flash, typed and sent `Reply only: Connection OK.`. UI showed 抓虾中 with elapsed time and completed with `Connection OK.` (2 seconds displayed).
2. Opened the model selector and switched to managed-gpt-6-luna. Typed and sent `Reply only: GPT connection OK.`. UI showed 抓虾中 and completed with `GPT connection OK.` (7 seconds displayed).
3. Restarted with the final export-menu patch. Both completed responses remained readable in `Connection OK test reply`; no native right-sidebar toggle, Open In split button, or native export ellipsis was present.
4. Clicked Harness resource toggle to collapse and reopen; browser/artifact sections remained accessible. Left workspace/session navigation remained functional.
5. Opened account menu → 套餐与用量. Actual page displayed Pro and approximately CNY 0.03 cumulative key usage. Page correctly distinguishes key limit from wallet balance.

No fixture replaced the model service. This validates basic text generation on both OpenAI-compatible Chat Completions and Responses routes, not attachment extraction, image generation, long-running tasks, or every model.

## Automated validation

- Desktop regression suite: 989 passed.
- Final compatibility + profile worker suite: 21 passed (quota/auth distinction, branded strings, embedded/standalone UI boundaries, profile behavior).
- Vite production build passed (existing chunk-size warning).
- git diff --check passed.

The pre-existing generated PTC persona change in the profile is outside this fix and remains uncommitted. Owner Pro grant audit is in the ModelJetty repository's docs/verification/owner-pro-verification-2026-10-22.md; it is a one-time test credit and non-recurring entitlement, not a paid monthly subscription.

## v0.5.0 restoration closeout (2026-10-22)

This section supersedes the earlier Key-quota display and uncommitted-persona notes.

### Included product changes

- Settings performance/navigation redesign is already in `b163db907`; current changes restore the shared Harness theme rather than a separate black palette.
- Managed account page now groups identity, plan badge, membership management, device activity, privacy preference and device sign-out. Both light and dark themes and activity refresh were exercised in Electron.
- Account footer and account menu display the plan badge. Usage reads the account-scoped allowance and shows remaining balance instead of the API Key's unlimited setting. Authorized ModelJetty account-service deployment and read-only balance access were verified separately; no repeated credit grant was made.
- Added read-only 14-day device activity endpoint and chart. UTC window excludes historical/future rows and includes completed/failed run counts correctly. It is explicitly device activity, not whole-account billing.
- Restored welcome text, attachment controls, native image-draft adapters, composer selectors and session navigation for rc.2. Avoided replacing React-owned children. TXT upload and actual model extraction succeeded.
- Added model-family marks and concise display names; actual model picker trigger displays `DeepSeek Flash` after the backend reload.
- C09/C10 repair embedded robot settings and the Connection webServer dependency. Actual WeChat, Feishu and DingTalk settings load without HTTP 405; no real bot pairing was performed.
- Plugin entry moves to Settings. C11 hides native plugin/schedule entries. Per the user's later decision, no native schedule page is embedded and TaskCenter retains its original architecture.
- Suppressed the obsolete Chinese/English add-file/command tooltip, while preserving attachment and other tooltips.
- Per final user direction, C12 removes the running icon entirely; `抓虾中` and elapsed time remain. The earlier spinning shrimp design is superseded.
- Retained the existing local PTC persona additions in the reviewed profile: independent execution contexts, discover tools before invoking, serialize approval/long-running operations and read back timed-out tasks before retrying.
- Removed temporary stderr forwarding used during IM diagnosis. Updated test fixtures for rc.2 navigation and tooltip contracts.

### Final checks

- `npm --prefix app test`: **990 passed**. First run found two outdated fixtures (tooltip matching and missing navigation helpers); corrected fixtures and reran the full suite successfully.
- `node --test integrations/deepseek-harness/compat/*.test.mjs`: **21 passed**, including embedded navigation and migration from both whale/shrimp icon implementations.
- `venv/bin/python3 -m pytest tests/test_managed_models.py tests/test_llm_gateway.py tests/test_agent_usage.py -q`: **37 passed, 4 subtests passed**. System Python lacks MCP dependencies; use the project venv.
- Vite production build passed after account redesign; existing chunk-size warning remains.
- `node integrations/deepseek-harness/scripts/stage-runtime.mjs`: staging complete, Web profile config check OK.
- `git diff --check`: passed.

### Explicit remaining verification limits

- Plugin Settings page is implemented but the final live navigation attempt was interrupted twice by concurrent user input; not claimed as visually accepted.
- Image attachment submission and draft removal still need end-to-end verification. TXT extraction is verified.
- Actual robot binding, all model families and full cross-platform/signed desktop release are outside the completed checks.
- No quantitative frame-rate benchmark was collected for Settings switching.
- ModelJetty production account-service changes live in its own repository and are not part of this Harness commit.

This is a local v0.5.0 checkpoint commit, not a desktop release or a claim that every remaining scenario has passed. No push or release was performed.
