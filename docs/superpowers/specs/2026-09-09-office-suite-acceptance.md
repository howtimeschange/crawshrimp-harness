# Office 三件套实际验收记录

日期：2026-09-09。实现与最终安装包源码：`fc68b3f2`，已在本地 `main`。本文是后续文档提交，不改变包内实现。本次未 push、发布或公证。

## 交付内容

- Python 3.12.13；新增 python-docx 1.2.0、python-pptx 1.0.2、pandas 3.0.5、matplotlib 3.11.1；复用 openpyxl 3.1.5、xlrd 2.0.2、Pillow 12.3.0、PyMuPDF 1.28.2。三目标完整版本/hash 锁和离线安装入口在 `runtime-locks/`。
- LibreOffice 26.2.6、思源黑体/宋体 SC Regular/Bold 随运行资源交付。字体供内置渲染器使用，无需安装到系统。
- 七个办公工具、三件套 Skill 和真实模板；`CRAWSHRIMP_PYTHON_EXECUTABLE` 贯穿工具、CLI 和 Skill 执行约定，保留 venv 入口路径，避免解析软链接后绕过虚拟环境。
- 原件重新打开验证、Excel 重算、PDF/逐页 PNG、revision 与页面 SHA 绑定的视觉检查记录，以及资源面板翻页和检查状态。

## main 开发客户端实机

验收使用 `/Users/xingyicheng/Documents/crawshrimp-harness` 的 main Electron，页面 `http://127.0.0.1:5173`，运行时页面端口 19066。原独立分支开发客户端已关闭，未重启。干净 main 快照的构建复用原独立目录的依赖缓存，不以其客户端结果替代 main 实机结果。

会话：`验收办公三件套Skill并生成样例`，ID `session-5ccbf7b7-83b2-41b6-9fd1-b1cf492d08fd`。

| 格式 | 最终 render job | 结构 | 真实视觉记录 |
| --- | --- | --- | --- |
| Word | `7b22cf3f9ab24f9f9324fea731eac801` | passed，10 段落、1 表格 | passed，3/3 页 |
| PPT | `fd4dde0bc1d74573baf7b01af2c8110c` | passed，5 页 | passed，5/5 页 |
| Excel | `cb476129ac02461cbfb70e361abdf810` | passed，3 工作表、4 公式、已重算 | passed，3/3 页 |

每页实际经过 `office_preview_read` → 已有配对视觉模型 → `office_review_record` 返回 JSON → `office_job` 确认；最终直接读取 manifest，核对 `delivered_pages`、`reviewed_pages` 和 `result.visual`。仅采用修复后的最终记录，先前被错误桥联影响的检查记录不作验收依据。

Excel 数据表商品编号 `00123`、`00456` 保留前导零；金额 39.00、30.00，汇总缓存值 69，IF 结果“有销售”；页图中分别显示 69.00 和“有销售”。公式和缓存双重读取通过。

main 资源面板检查：Word 下一页、PPT/Excel 下一页与上一页，页码和图像同步；分别显示已完成 3/5/3 页视觉检查。“打开 PDF”由 WPS 打开中文报告 PDF；三份可编辑原件均经“系统打开”在 WPS 正常打开。

WPS 对 Word/PPT 提示系统缺少部分字体并使用替代字体，因此此次系统打开证明原件可打开，不代表第三方编辑器排版与 Harness 像素一致。Harness 的内置 LibreOffice PDF 使用随包思源字体，逐页检查以该 PDF/PNG 为准。样例包含模板占位文字和较多留白，本次证明运行链路，不把样例当作完成的业务报告。

## 实机发现与修复

复用已有 DeepSeek 图片桥联，未新增独立视觉路由或修改用户模型配置。实际发现 DSH 在桥联之前按文本模型能力丢弃工具图片；在已有官方配对视觉模型和附件服务可用时，适配器才宣告图片能力。无配对配置继续保持原行为。

另一个问题是工具图片可能嵌在 `role:user` 的 `tool-result` 中。原桥联携带系统指令和工具历史时，视觉输出会混入任务续写。`crawshrimp-office-bridge-transport-v2` 展开最新含图消息，仅向视觉模型提交当前页及图片识别指令，主智能体工具历史保持不变。真实工具调用和记录读回确认修复生效。

视觉模型曾把旧图最高柱读成 140；查看原 PNG 未见截断。为减少数值误读，样例图新增柱顶 100/120/150 标签与 Y 轴顶部留白，重新生成 Word/PPT 后全部检查通过。不能将旧模型所说的“截断”当作已证实的原图缺陷。

打包阶段另修复 LibreOffice 相对软链接复制和 venv 解释器路径处理；迁移到新目录后再次原生执行通过。

## 回归与构建证据

| 检查 | 实际结果 | 本地日志 |
| --- | --- | --- |
| 合入阶段 Python 全量 `venv/bin/python3 -m pytest tests -q` | 1655 passed，1 skipped，45 subtests；发生在最终桥联修复之前 | `main-integration-python.log` |
| 最终 main Node `npm test`（app） | 726 passed，0 fail | `.codex-tmp/office-main-final-node-tests2.log` |
| 最终 Office Python `venv/bin/python3 -m pytest tests/test_office_runtime.py -q` | 14 passed | `.codex-tmp/office-main-final-python.log` |
| 视觉桥联与 stage 相关测试 | 13 passed，含当前页隔离、嵌套工具图片、无配对配置和历史保留 | `.codex-tmp/office-vision-stage-tests.log` |
| 干净 main `stage-runtime.mjs --force` | 完成，Web config check OK | `final-main-stage2.log` |
| 最终 renderer 构建 | passed | `final-main-renderer2.log` |
| 最终 ARM electron-builder | after-pack Office 原生门禁、ad-hoc 签名、DMG/blockmap 完成，exit 0 | `final-main-package2.log` |

上述未带目录的日志已归档至主项目 `.codex-tmp/dont-stop/office-suite/`。最终 Node 测试曾遇到并行附件修改后的过时断言；按当前原生文件选择器 `filters: []` 契约更新断言，仍检查图片/表格/PDF 分类，完整重跑通过。

## 最终本地安装包

- 文件：`.codex-tmp/office-final-package/crawshrimp-harness-v0.1.13-mac-arm64.dmg`
- 大小：931,143,022 bytes（约 888.0 MiB）。
- SHA-256：`eaf5e5966466879d97da574d49b6cf051b74e3fceeed605a8bc4bc624fe77ad8`
- 构建：`CSC_IDENTITY_AUTO_DISCOVERY=false CRAWSHRIMP_NOTARIZE_APP=0 node app/scripts/run-electron-builder.js --mac dmg --arm64 --publish=never --config.mac.identity=-`
- 从只读挂载的 DMG 复制到 `.codex-tmp/office-final-installed/抓虾 Harness.app` 后卸载 DMG，使用新位置的包内 Python、LibreOffice、字体实际生成并重新打开、渲染 Word 3 页/PPT 5 页/Excel 3 页；结构全部 passed，Excel 重算通过。
- 迁移后的 `codesign --verify --deep --strict` exit 0。运行未依赖已卸载的 DMG 路径。
- 冒烟报告：`.codex-tmp/dont-stop/office-suite/final-installed-smoke/report.json`，`ok:true`。该报告中的 `visual:not_run` 表示包内冒烟只做结构/渲染；真实模型视觉证据来自上面的 main 会话，两者不可混为一项。

安装包验证在后续工作中放到开发、回归和 main 客户端验收之后。当前包与最终实现一致，复用已有结果；仅补文档不重复打包。

## 未执行边界

- macOS Intel、Windows x64 已有锁与目标离线依赖准备，未在对应硬件/系统原生运行，不能标全平台可用或发布通过。
- 未执行正式开发者签名、公证、Windows 安装器、升级安装和最低系统版本矩阵；当前仅为本地 ad-hoc ARM 验证包。
- 未把设计矩阵里的复杂跨页表格、长标题/复杂对象往返、人工截断/重叠缺陷夹具识别，以及两个真实桌面会话并发取消逐项做完；已有自动化覆盖不替代这些集成验收。
- 未在完全干净、没有任何第三方 Office/Python 的新系统做安装验收。本机包内模块路径、迁移后独立执行和字体嵌入已经验证。

本机实现、回归与 main 实机链路通过；跨平台正式交付验收保持未完成状态，等待相应运行环境。
