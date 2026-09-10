# 走查问题修复与复测记录

日期：2026-09-10。对应 [原走查报告](2026-09-10-final-experience-walkthrough.md)。本轮先复现并定位，再修改代码，使用用户已经运行的开发版 Electron 验证；没有启动第二个客户端。

## 修复结果

| 问题 | 修复与实际证据 | 验证边界 |
| --- | --- | --- |
| F01 历史消息空白 | 自动化回执改用 SDK 的 snapshotEvents()，避免对旧会话重复追加 turn 1；启动迁移修复已损坏回执轮次。原 QA 会话切换及 Cmd+R 后能显示正文、工具、历史失败回执和新成功回执。 | 未穷尽所有长短会话和分页组合。 |
| F02 Office 交付版本错误 | 新增 office_deliver(job_id, revision)，校验文件哈希、验证修订及逐页视觉记录，再注册同一文件；普通 Web 文件回传阻止绕过该流程。原 Office 会话实际重新交付正确的 13,200 字节 Excel，资源区显示“已验收交付”，点击显示 1/3 页及已检查 3 页。 | 本轮实际复看第 1 页；3 页记录为此前持久化验收证据。未验证 IM 交付，保护逻辑限定 Web。 |
| F03 最小权限自动化失败 | 无人值守上下文明确调度器已经触发，不需额外时间/bash 前置调用。新一次性任务自然触发成功，仅调用 automation_record_verification，成功回执在源会话刷新后仍可见。 | 没有扩大权限；单次自然执行通过，不代表所有模型输出均确定。 |
| F04 UI 页面未复用 | UI 新建及选择页面同步会话 browser_tab_id，选择接口验证所属会话与存活页面。实际新建 blank 后下一轮导航 example.com，仍为同一 tab ID，页面数为 1。 | 本轮未再次完整实测多页选择和关闭后的工具调用；外来/关闭页面拒绝有测试覆盖。 |
| F05 CSV 拆成字符 | 使用 csv.reader 解析逻辑记录，保留字符串及前导零。同一附件 att-003e00e9b1e6 实际返回两行两列：00123/12.5、00456/-2.5。 | 引号逗号、换行、中文、空字段等由自动化测试覆盖。 |
| F06 计划与完成答复矛盾 | 增加按证据收尾的指令，空闲但未完成的计划明确标注“本轮已结束 · 计划尚未收尾”，停止进行中动画。原 Office 任务核对验收记录后更新为 7 项已完成。 | 未强制把所有任务改成完成；未来计划收尾仍依赖模型遵循指令，UI 如实提示遗留项。 |
| F07 内容搜索不可用 | 启用 first-search 索引；修复旧 output-recovery 助手消息的非法 plugin 来源，并增加搜索重试入口。现有客户端搜索正文关键词 00456 返回 3 个会话及对应正文片段，无降级警告。 | 已验证匹配片段及打开会话；未证明自动滚动到具体消息。 |
| F08 小文件误报截断 | 根据 Content-Range 的实际范围判断，并通过 CORS 暴露范围响应头。重启核心服务后实际重开 33 字节 CSV 和 658 字节 Markdown，均显示完整文本，无截取警告。 | 大文件/未知长度分支有单测，未新建大型实际文件验证。 |

## 关键持久化证据

- 数据根目录保持 `/private/tmp/crawshrimp-harness-main-dev-20260907/runtime-data`。通过既有客户端“修复核心服务”加载后端修改；端口在服务重启中重新分配，不依赖旧端口判断实例。
- F01：产品会话 `cs-web-8cd9d6f4bd2a`，运行时会话 `session-046e5538-2d45-4252-8a06-cfcde38e21bf`。原 9444 个事件中轮次 `[1..8,1,9]` 修复为 `[1..10]`，保留事件序号和消息正文。
- F07：用户报告的 `session-933566b7-a7e5-4b0f-9ec2-00ad6d8e3d45`、seq 34009 属于旧恢复提示格式；仅将已知 `crawshrimp-output-recovery` 来源正规化为 model/provider/model 字段。只读检查的 42 个压缩会话中该会话存在这一旧格式，迁移保留正文。
- 两个原始压缩记录备份位于数据根下 `agent/harness-sessions/--private-tmp-crawshrimp-harness-main-dev-20260907-runtime-data-agent-workspace--/`，分别为上述会话目录中的 `session.jsonl.zstd.before-receipt-turn-repair` 和 `session.jsonl.zstd.before-product-history-repair-v2`。没有删除聊天内容。
- F02：正确 job `f4901de35cb64dfeb220052c5ce803fe`；文件 SHA-256 `4c91960081e4082992184c579d1074708db2463d3b4fa0105f04b794aea36a91`。路径为数据根下 `agent/workspace/outputs/office/9e82a60e25fba8bf5dbd4f8a/f4901de35cb64dfeb220052c5ce803fe/editable/示例零售2026经营数据报表-行高修正版.xlsx`。旧同名文件保留。后续增加的验证修订/非空页校验已通过测试并加载，未再次重复交付。
- F03：`QA-0910-fixed-once`，UID `d5f10f2542e14d87b0ea0a739b76fe19`，run `run-c3b3e61f6be3`。10:59:03.014 +08 自然开始，10:59:04.352 完成；notification delivered；全部五项 allow_* 为 false，仅授权 record_verification；enabled=0，无下次执行。
- F04：本轮复用标签 `A49035AB40B3876E7980154BEC41CCF1`，收尾已关闭，客户端显示浏览器页面 0。没有留下新的持续测试任务。

## 自动化验证

- session_resources + acceptance_fixes：19 passed。
- office_runtime + agent_automation_mcp + automation_controller：99 passed。
- walkthrough_regressions：5 passed；后续 Office 校验加固与 office_runtime 合跑 19 passed。
- 回执集成、reasoning recovery、compact chat、text preview、磁盘迁移 Node 合跑：48 passed；磁盘迁移夹具加强后单独 3 passed，覆盖备份及重复运行无修改。
- `stage-runtime.mjs --force --skip-boot-check`：干净安装和补丁锚点检查通过。明确跳过 boot check，没有据此宣称额外启动验证。
- `npm run vite:build`：通过，存在大 chunk 提示。
- `git diff --check`：通过。

本轮为本地源码和现有 macOS 开发客户端修复。未提交 Git、推送、打包或发布；Windows、安装升级、IM、真实业务写入等原报告未覆盖项仍需独立验收。原报告与原证据保持不变。
