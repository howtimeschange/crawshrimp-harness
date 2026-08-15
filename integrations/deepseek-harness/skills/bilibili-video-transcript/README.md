# Bilibili Video Transcript Skill

一个用于 B 站视频字幕、章节、元数据和 ASR 转写材料抓取的 Codex skill。

## 能做什么

- 从 B 站 BV 链接解析 `bvid`、`aid`、`cid`、标题、作者和时长。
- 调用 B 站播放器接口检查公开字幕和官方章节。
- 有公开字幕时抓取字幕清单；在授权模式下可写出完整字幕文件。
- 没有字幕时可通过 playurl 抓取音频，并用 `faster-whisper` 做 ASR。
- 默认把签名媒体 URL、原始音频、原始 ASR 放在 `work/`，把脱敏报告放在 `outputs/`。
- 帮助生成时间轴梗概、整理稿、抓取报告等交付材料。

## 抓虾 Harness 内置版

本内置版已经随应用放在 `skills/bilibili-video-transcript` 目录。运行脚本前先进入该目录。

如需 ASR：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -U pip
.venv/bin/python -m pip install -r requirements.txt
```

## 使用示例

基础抓取：

```bash
python3 scripts/bilibili_video_capture.py \
  "https://www.bilibili.com/video/BV1E7wtzaEdq/" \
  --output-root outputs \
  --work-root work
```

无字幕时启用 ASR：

```bash
python3 scripts/bilibili_video_capture.py \
  "https://www.bilibili.com/video/BV1E7wtzaEdq/" \
  --output-root outputs \
  --work-root work \
  --asr \
  --model small
```

授权逐字稿模式：

```bash
python3 scripts/bilibili_video_capture.py \
  "https://www.bilibili.com/video/BV..." \
  --output-root outputs \
  --work-root work \
  --asr \
  --authorized-verbatim
```

## 版权和隐私边界

默认不把第三方视频的完整逐字稿写入交付目录，也不在聊天里返回完整逐字稿。只有当用户确认拥有版权或授权时，才使用 `--authorized-verbatim` 写出完整字幕或 ASR 转写文件。

签名媒体 URL、cookies、auth headers、原始音频和原始 ASR 都应保留在 `work/`，不要提交到 GitHub。

## 仓库结构

```text
skills/bilibili-video-transcript/
  SKILL.md
  agents/openai.yaml
  references/bilibili_api.md
  scripts/bilibili_video_capture.py
requirements.txt
README.md
```

## 校验

```bash
python3 -m py_compile scripts/bilibili_video_capture.py
```
