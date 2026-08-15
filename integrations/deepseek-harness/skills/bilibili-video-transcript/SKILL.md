---
name: bilibili-video-transcript
description: Capture and prepare Bilibili video transcript packages from bilibili.com or m.bilibili.com URLs. Use when a user asks to extract Bilibili subtitles, chapters, metadata, AI summaries, audio-backed ASR materials, timestamped notes, or transcript-style deliverables from a Bilibili BV/AV video link.
---

# Bilibili Video Transcript

## Overview

Capture Bilibili video evidence before writing summaries or transcript-style deliverables. Prefer platform subtitles and official chapters; use audio ASR only when subtitles are absent or unusable.

## Workflow

1. Create a safe output directory, normally `outputs/bilibili_<bvid>/`, and a private scratch directory, normally `work/bilibili_<bvid>/`.
2. Run the bundled script:

```bash
python3 scripts/bilibili_video_capture.py "<bilibili-url>" --output-root outputs --work-root work
```

3. Inspect the generated files:
   - `metadata_sanitized.json` for title, author, `aid`, `cid`, duration, chapter list, and subtitle status.
   - `player_v2.json`, `view.json`, and `pagelist.json` for API-backed evidence.
   - `subtitle_manifest.json` when platform subtitles are exposed.
   - `capture_report.md` for a readable status summary.
   - `timeline_chapters.md` for official chapter timing.
4. If `metadata_sanitized.json` says subtitles are missing and the user still needs transcript material, rerun with ASR:

```bash
python3 scripts/bilibili_video_capture.py "<bilibili-url>" --output-root outputs --work-root work --asr --model small
```

5. Use raw ASR artifacts in the work directory only as source material. Write user-facing deliverables as one of:
   - a timestamped paraphrased timeline,
   - a continuous paraphrased transcript-style note,
   - a summary plus key quotes within policy limits,
   - a full verbatim transcript only when the user confirms they own the content or have permission.

## Copyright And Privacy Guardrails

- Do not return a complete verbatim transcript of a third-party copyrighted Bilibili video in chat.
- Do not place full raw ASR text or full platform subtitles in the user-facing output directory unless `--authorized-verbatim` is appropriate for the task.
- Keep signed media URLs, cookies, auth headers, and raw media in the private work directory.
- Clean raw audio and raw ASR files after generating the final deliverables unless the user asked to preserve them.
- Cite that platform subtitles were absent when `subtitles: []` is returned.

## Script Usage

Basic metadata, official chapters, subtitle probe, and safe report:

```bash
python3 scripts/bilibili_video_capture.py "https://www.bilibili.com/video/BV..." --output-root outputs --work-root work
```

ASR fallback with temporary audio:

```bash
python3 scripts/bilibili_video_capture.py "https://www.bilibili.com/video/BV..." --output-root outputs --work-root work --asr --model small
```

Authorized verbatim mode for user-owned or licensed content:

```bash
python3 scripts/bilibili_video_capture.py "https://www.bilibili.com/video/BV..." --output-root outputs --work-root work --asr --authorized-verbatim
```

## API Notes

Read `references/bilibili_api.md` when the public endpoints fail, WBI signing is needed, `yt-dlp` returns HTTP 412, or you need to explain why subtitles or AI summaries are unavailable.

## Completion Standard

Before reporting success, verify:

- metadata exists and includes `bvid`, `aid`, `cid`, title, author, and duration;
- subtitle status is recorded, including an empty `subtitles` list when applicable;
- official chapters are captured when Bilibili returns `view_points`;
- ASR stats are recorded when ASR was used;
- signed URLs and raw media are not in the final output directory.
