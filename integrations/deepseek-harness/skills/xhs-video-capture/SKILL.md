---
name: xhs-video-capture
description: Use when a user asks to download, archive, transcribe, summarize, or verify a Xiaohongshu/RedNote video from an xhslink.com or xiaohongshu.com URL, especially when they want local MP4 files, platform subtitles, transcripts, metadata, screenshots, or a reusable evidence-backed workflow.
---

# XHS Video Capture

## Overview

Capture Xiaohongshu/RedNote videos as local, verifiable artifacts before summarizing them. Prefer platform-exposed subtitles from the page SSR state; use local audio transcription only when subtitles are absent or unusable.

## Workflow

1. Create an output directory under the current project, normally `outputs/xhs_<note_id>/`.
2. Run the bundled capture script:

```bash
python3 scripts/xhs_video_capture.py "<xhs-or-xhslink-url>" --output-root outputs
```

3. Inspect the generated files:
   - `*.mp4` for the downloaded video.
   - `page_note_extracted.json` for title, author, tags, video streams, and subtitle URLs.
   - `subtitle_*.srt` for platform subtitles.
   - `transcript_with_timestamps.md`, `transcript_by_minute.md`, and `transcript_plain.txt` for cleaned transcript outputs.
   - `frame_contact_sheet.jpg` for a fast visual sanity check.
   - `ffprobe.json` for codec, duration, and size verification.
4. Write the user-facing summary from the transcript and visual check. Do not claim the video is captured until the local file, transcript, and verification JSON exist.
5. If the user asked for a single handoff file, create `summary_and_transcript.md` in the output directory with:
   - source URL and note ID
   - local video path
   - metadata summary
   - concise content summary
   - transcript file references, or a short embedded transcript when acceptable

## Fallbacks

- If `yt-dlp` fails but `page_note_extracted.json` contains `master_url` or backup URLs, try direct `curl -L` download with a browser-like user agent and Xiaohongshu referer.
- If platform subtitles are missing, extract audio with `ffmpeg` and use the project's configured speech-to-text or video-understanding tool. Record which engine produced the transcript.
- If the SSR state cannot be parsed, save the raw HTML and switch to browser/CDP inspection. Look for `window.__INITIAL_STATE__`, `noteDetailMap`, `mediaV2`, `stream.h264`, and `video.subtitles`.
- If a signed media URL expires, re-fetch the page and rerun the script rather than reusing stale URLs.

## Verification Gate

Before reporting success, run or confirm:

```bash
find outputs/xhs_<note_id> -maxdepth 1 -type f -print
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,duration -of json outputs/xhs_<note_id>/*.mp4
```

Report gaps plainly. A browser page opening, a partial metadata JSON, or a transcript without a local video is not enough.

## Common Mistakes

- Treating `yt-dlp --dump-json` as a completed capture. It proves extractability, not local archival.
- Trusting `yt-dlp --write-subs` for Xiaohongshu subtitles. The page may expose subtitles in `mediaV2.video.subtitles` even when yt-dlp reports none.
- Summarizing from title and hashtags only. Read the transcript and check frame contact sheet first.
- Publishing private URLs, cookies, tokens, or full user session headers in skill repos. Keep only reusable workflow logic.
