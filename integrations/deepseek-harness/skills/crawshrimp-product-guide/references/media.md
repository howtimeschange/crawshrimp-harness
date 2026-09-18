# 图片视频执行指引

这些说明不新增授权，始终遵守用户明确约束与产品权限。

生图与生视频执行:
- 生图模型：先调用 image_models 查看已配置的供应商与模型，使用用户指定的完整 model ID；未指定时从已配置模型中选择，不要在只有沃卡/森马 Key 时使用无前缀的 1XM 模型。自定义模型保留 custom-供应商ID/原始模型ID。
- 文字生图：目标明确时直接调用 image_generate，prompt 写清主体、场景、构图、风格和用户要求；按要求传 count（1-4）、size、quality、output_format。未指定的参数使用工具默认值；key_tier 留空让服务选择可用配置，用户明确指定档位时遵守指定值。不要要求用户提供 API key。
- 参考图生图/改图：用户要求基于聊天图片修改时，先查看图片，明确要保留和修改的内容，再调用 image_generate，把图片上下文中提供的 Normalized copy 只读本地路径传入 reference_image_paths；无需复制或改名，不能仅把路径写入 prompt。抓虾附件提供 attachment_id 时可通过 reference_attachment_ids 传入当前会话附件；原生 sha256 图片标识不是抓虾附件 id，应使用其只读路径。可组合多张参考图（合计最多 10 张，PNG/JPEG/WebP，每张不超过 20MB），按传入顺序说明各图用途。仅使用用户指定的参考图，不自动带入无关历史图片；没有路径或附件 id 时先找回实际附件，无法取得则请用户重新附图。参考图条件生成不能保证商品细节完全不变，生成后应检查用户要求的保留项，未检查时不要声称完全一致。纯文字生图不传参考图参数。
- 生视频：先调用 video_models 检查可用模型及配置状态，再调用 video_generate，按目录传 provider 和 model，prompt 写清主体、动作、场景、镜头运动和风格；用户指定时传 duration。图生视频先确认实际可读的首帧图，再通过 first_frame_image 传入真实本地路径；文字生视频留空该参数。工具未暴露的尺寸或运镜参数不可自行添加。
- 用户要求先生成图片再生成视频时，先完成 image_generate，使用其返回的实际图片路径作为 video_generate 的 first_frame_image；多张候选图无法判断用户意图时先确认选择。只执行用户要求的步骤。
- 生成调用本身会等待结果，调用仍在运行时不要再次提交同一任务。超时或状态不明时先用 image_assets/video_assets 核对已有产物和任务标识；列表不足以确认时说明状态未知，不盲目重试。MISSING_CONFIG、失败和审批拒绝要据实说明，不能把已提交当作已生成。
- 交付：检查返回的 delivery。requires_file_return=false 表示产物已提交到当前会话，直接总结，不重复回传、复制或重新生成；这不等于已验证用户端展示或 IM 送达。requires_file_return=true 时使用返回路径和当前可用的文件交付能力；没有回传工具则提供真实路径并说明交付限制。不要为了交付而重做产物。image_assets/video_assets 用于查询已有产物，不能把无关历史结果当作本次生成结果。
