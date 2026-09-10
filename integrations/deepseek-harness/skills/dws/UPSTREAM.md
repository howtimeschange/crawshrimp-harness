# DWS upstream

- Repository: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli
- Release: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.61
- Source: verified `dws-skills.zip` from this release, SHA256 `24b4c48b4bf095cc8f749b60ad021716141c997f5ca38cc0883fd4f1d50f7acd`.
- Imported root mono skill, references and scripts; duplicate mono/multi trees omitted.
- Local changes: added the Crawshrimp runtime/authorization section to SKILL.md; normalized trailing whitespace in four reference files.
- LICENSE and NOTICE retained. Binary assets and SHA256 values are pinned in `integrations/deepseek-harness/dws-release.json`.
- Builds fetch only the target platform binary; no user-global installer or automatic DWS self-update.
