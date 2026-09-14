---
name: image-generation
description: 使用 Harness 本机配置生成和编辑图片，支持 1XM、沃卡、森马网关及自定义供应商。
---

优先调用 `image_models` 查看模型与配置状态，再调用 `image_generate`，由 Harness 把图片交付到会话。无需读取密钥文件或要求用户设置供应商环境变量。

- 沃卡：`woka/gpt-image-2`、`woka/gemini-3.1-flash-image-preview`、`woka/gemini-3-pro-image-preview`。
- 森马：`semir/gpt-image-2`、`semir/gemini-3.1-flash-image-preview`、`semir/gemini-3-pro-image-preview`。
- 自定义模型：使用 `image_models` 返回的完整 ID。
- 无供应商前缀的模型沿用 1XM。

脚本场景使用 `$CRAWSHRIMP_PYTHON_EXECUTABLE scripts/generate.py --list-models`，或 `--prompt 提示词文件 --model 模型ID --reference 参考图路径 --out 输出路径`。GPT 尺寸用 `1024x1024` 等像素值；Nano 可用 `1K`、`2K`、`4K`。脚本复用运行中的 Harness 后端及本机配置，生成结果存入任务历史。

同步供应商断连、超时或网关 502/504 后可能已经生成，必须核实已有任务及供应商记录，不自动重提。真实输出尺寸以图片文件为准。
