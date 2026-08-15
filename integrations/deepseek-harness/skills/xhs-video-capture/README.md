# xhs-video-capture

Codex skill for downloading Xiaohongshu/RedNote videos, extracting platform subtitles, generating local transcripts, and verifying captured media.

## 中文说明

`xhs-video-capture` 是一个 Codex skill，用来把小红书/RedNote 视频链接抓取到本地，并生成可核验的交付文件。

它适合处理来自 `xhslink.com` 或 `xiaohongshu.com` 的视频链接，默认流程会下载 MP4、保存笔记元数据、提取页面里暴露的平台字幕、生成逐字稿，并用 `ffmpeg/ffprobe` 生成抽帧预览和媒体校验信息。

### 安装

```bash
npx skills add howtimeschange/xhs-video-capture
```

### 依赖

- Python 3.10+
- `yt-dlp`
- `ffmpeg` and `ffprobe`

### 使用

```text
用 $xhs-video-capture 把这个小红书视频抓到本地，提取逐字稿并总结内容：<url>
```

也可以直接运行内置脚本：

```bash
python3 scripts/xhs_video_capture.py "<xhs-or-xhslink-url>" --output-root outputs
```

脚本会生成 `outputs/xhs_<note_id>/` 目录，常见产物包括：

- `*.mp4`：本地视频文件
- `page_note_extracted.json`：标题、作者、标签、视频流和字幕地址等元数据
- `subtitle_*.srt`：平台字幕
- `transcript_with_timestamps.md`：带时间轴逐字稿
- `transcript_by_minute.md`：按分钟整理的逐字稿
- `transcript_plain.txt`：纯文本逐字稿
- `frame_contact_sheet.jpg`：抽帧预览图
- `audio.wav`：抽取出的音频
- `ffprobe.json`：视频编码、时长、尺寸等校验信息
- `capture_report.md`：抓取结果摘要

### Skill 内容

- `SKILL.md`：抓取流程、回退策略和核验要求。
- `scripts/xhs_video_capture.py`：视频、字幕、逐字稿和媒体校验抓取脚本。
- `agents/openai.yaml`：Codex UI 元数据。

### 注意事项

- 默认不保存原始 `page.html`，避免把临时签名 URL 写进产物；调试时可显式加 `--save-html`。
- 小红书页面经常会暴露平台字幕，即使 `yt-dlp --write-subs` 显示没有字幕，也应检查页面 `mediaV2.video.subtitles`。
- 不要只凭标题或标签总结内容，应先读取逐字稿并检查抽帧预览。

## English

`xhs-video-capture` is a Codex skill for capturing Xiaohongshu/RedNote videos as local, verifiable artifacts.

It works with `xhslink.com` and `xiaohongshu.com` video URLs. The default workflow downloads the MP4, saves note metadata, extracts platform subtitles exposed in the page state, generates cleaned transcripts, and uses `ffmpeg/ffprobe` to create a visual contact sheet and media verification data.

### Install

```bash
npx skills add howtimeschange/xhs-video-capture
```

### Requirements

- Python 3.10+
- `yt-dlp`
- `ffmpeg` and `ffprobe`

### Usage

```text
Use $xhs-video-capture to download this Xiaohongshu video locally and summarize the transcript: <url>
```

You can also run the bundled script directly:

```bash
python3 scripts/xhs_video_capture.py "<xhs-or-xhslink-url>" --output-root outputs
```

The script writes an `outputs/xhs_<note_id>/` folder. Typical artifacts include:

- `*.mp4`: local video file
- `page_note_extracted.json`: title, author, tags, video streams, subtitle URLs, and other metadata
- `subtitle_*.srt`: platform subtitles
- `transcript_with_timestamps.md`: timestamped transcript
- `transcript_by_minute.md`: minute-grouped transcript
- `transcript_plain.txt`: plain text transcript
- `frame_contact_sheet.jpg`: visual frame contact sheet
- `audio.wav`: extracted audio
- `ffprobe.json`: codec, duration, dimensions, and size verification
- `capture_report.md`: capture summary

### Skill Contents

- `SKILL.md`: workflow, fallback, and verification guidance.
- `scripts/xhs_video_capture.py`: capture utility for video, subtitles, transcripts, and media verification.
- `agents/openai.yaml`: Codex UI metadata.

### Notes

- Raw `page.html` is not saved by default to avoid storing signed temporary URLs; pass `--save-html` only for debugging.
- Xiaohongshu pages may expose platform subtitles in `mediaV2.video.subtitles` even when `yt-dlp --write-subs` reports none.
- Do not summarize from title and tags alone; read the transcript and check the frame contact sheet first.

## License

MIT
