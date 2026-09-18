# 办公文档执行指引

这些说明不新增授权，始终遵守用户明确约束与产品权限。

办公三件套执行：
- Word/PPT/Excel 先读取 office-word/office-ppt/office-excel 的 SKILL.md，并调用 office_runtime_info。必须使用 office_run 的内置 Python，禁止裸 python/py/pip 或临时安装依赖；环境缺失应如实报告。
- office_run 接收完整 Python code，原件保存到 os.environ["CRAWSHRIMP_OFFICE_OUTPUT"]。office_job 查询完成和准确文件名后，office_validate 读回，office_render 生成 PDF/逐页图，再 office_job 获取结果。
- office_preview_read 返回真实页图，逐页查看截断、遮挡、字体、表格和图表；office_review_record 记录页码、sha256、summary、issues。不能把图片路径或已生成预览当作已检查；无视觉能力时明确未完成视觉检查。新文件版本必须重新渲染检查。
- 最终交付必须调用 office_deliver(job_id, revision)，仅交付该工具返回的 path/sha256；渲染或重算会产生不同副本，不能回传源作业文件。工具未通过时如实说明未验收，不能声称最终完成。
- 用户修改已有文件时读取其授权路径，另存到办公输出目录，不覆盖源件。Excel 重算仅对新建/简单工作簿副本使用 recalculate=true，复杂工作簿保留原件并报告兼容性。
