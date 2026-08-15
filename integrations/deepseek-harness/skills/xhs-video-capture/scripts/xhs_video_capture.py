#!/usr/bin/env python3
"""Capture a Xiaohongshu/RedNote video, subtitles, transcripts, and verification artifacts."""

from __future__ import annotations

import argparse
import glob
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)


def run(command: list[str], *, cwd: Path | None = None, required: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    if required and result.returncode != 0:
        message = "\n".join(
            part
            for part in [
                f"Command failed: {' '.join(command)}",
                result.stdout.strip(),
                result.stderr.strip(),
            ]
            if part
        )
        raise RuntimeError(message)
    return result


def fetch_text(url: str) -> tuple[str, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        final_url = response.geturl()
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace"), final_url


def normalize_js_state(raw: str) -> str:
    raw = re.sub(r"(?<=[:\[,])undefined(?=[,}\]])", "null", raw)
    raw = re.sub(r"(?<=[:\[,])NaN(?=[,}\]])", "null", raw)
    return raw


def parse_initial_state(html: str) -> dict[str, Any]:
    match = re.search(r"<script>window\.__INITIAL_STATE__=(.*?)</script>", html, flags=re.S)
    if not match:
        raise RuntimeError("Could not find window.__INITIAL_STATE__ in the Xiaohongshu page.")
    return json.loads(normalize_js_state(match.group(1)))


def first_note_from_state(state: dict[str, Any]) -> dict[str, Any]:
    note_store = state.get("note") or {}
    detail_map = note_store.get("noteDetailMap") or {}
    if not detail_map:
        raise RuntimeError("Could not find noteDetailMap in Xiaohongshu SSR state.")
    first_detail = next(iter(detail_map.values()))
    note = first_detail.get("note") or {}
    if not note:
        raise RuntimeError("Could not find note payload in noteDetailMap.")
    return note


def parse_media_v2(note: dict[str, Any]) -> dict[str, Any]:
    video = note.get("video") or {}
    raw = video.get("mediaV2")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    return json.loads(raw)


def safe_filename(value: str, fallback: str = "xhs-video") -> str:
    text = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", value).strip(" .")
    return text or fallback


def download_with_ytdlp(url: str, out_dir: Path) -> None:
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp is required to download the video.")
    output_template = str(out_dir / "%(title).80s [%(id)s].%(ext)s")
    run(
        [
            "yt-dlp",
            "--write-info-json",
            "--write-thumbnail",
            "-o",
            output_template,
            url,
        ]
    )


def download_subtitles(media_v2: dict[str, Any], out_dir: Path) -> list[dict[str, Any]]:
    subtitles = ((media_v2.get("video") or {}).get("subtitles") or {})
    manifest: list[dict[str, Any]] = []
    headers = {"User-Agent": USER_AGENT, "Referer": "https://www.xiaohongshu.com/"}
    for lang, entries in subtitles.items():
        for index, entry in enumerate(entries or []):
            url = entry.get("url")
            if not url:
                continue
            request = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    body = response.read()
            except urllib.error.URLError as exc:
                manifest.append({"lang": lang, "index": index, "url": url, "status": "failed", "error": str(exc)})
                continue
            path = out_dir / f"subtitle_{safe_filename(lang)}_{index}.srt"
            path.write_bytes(body)
            manifest.append({"lang": lang, "index": index, "url": url, "path": str(path), "bytes": len(body), "status": "ok"})
    (out_dir / "subtitle_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def parse_srt(path: Path) -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8-sig")
    blocks = re.split(r"\n\s*\n", text.strip())
    items: list[dict[str, str]] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < 3 or not re.fullmatch(r"\d+", lines[0]) or "-->" not in lines[1]:
            continue
        start, end = [part.strip() for part in lines[1].split("-->", 1)]
        items.append({"start": start, "end": end, "text": "".join(lines[2:]).strip()})
    return items


def choose_transcript_source(out_dir: Path) -> Path | None:
    preferred = [
        out_dir / "subtitle_source_0.srt",
        out_dir / "subtitle_zh-CN_0.srt",
        out_dir / "subtitle_zh_CN_0.srt",
    ]
    for path in preferred:
        if path.exists():
            return path
    matches = sorted(out_dir.glob("subtitle_*.srt"))
    return matches[0] if matches else None


def write_transcripts(out_dir: Path) -> dict[str, Any]:
    source = choose_transcript_source(out_dir)
    if not source:
        return {"status": "missing_subtitles"}
    items = parse_srt(source)
    plain = "".join(item["text"] for item in items)
    with_timestamps = "\n".join(f"[{item['start']} - {item['end']}] {item['text']}" for item in items)

    groups: list[tuple[int, str]] = []
    current_minute: int | None = None
    buffer: list[str] = []
    for item in items:
        minute = int(item["start"].split(":")[1])
        if current_minute is None:
            current_minute = minute
        if minute != current_minute:
            groups.append((current_minute, "".join(buffer)))
            current_minute = minute
            buffer = []
        buffer.append(item["text"])
    if buffer and current_minute is not None:
        groups.append((current_minute, "".join(buffer)))

    by_minute = "\n\n".join(f"### {minute:02d}:00\n{text}" for minute, text in groups)
    (out_dir / "transcript_plain.txt").write_text(plain, encoding="utf-8")
    (out_dir / "transcript_with_timestamps.md").write_text(with_timestamps, encoding="utf-8")
    (out_dir / "transcript_by_minute.md").write_text(by_minute, encoding="utf-8")
    return {"status": "ok", "source": str(source), "items": len(items), "plain_chars": len(plain)}


def find_video(out_dir: Path) -> Path | None:
    matches = sorted(Path(path) for path in glob.glob(str(out_dir / "*.mp4")))
    return matches[0] if matches else None


def make_media_artifacts(out_dir: Path) -> dict[str, Any]:
    video = find_video(out_dir)
    result: dict[str, Any] = {"video": str(video) if video else None}
    if not video:
        return result

    if shutil.which("ffprobe"):
        ffprobe = run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration,size",
                "-show_entries",
                "stream=codec_type,codec_name,width,height,r_frame_rate,duration",
                "-of",
                "json",
                str(video),
            ],
            required=False,
        )
        if ffprobe.returncode == 0:
            (out_dir / "ffprobe.json").write_text(ffprobe.stdout, encoding="utf-8")
            result["ffprobe"] = "ffprobe.json"

    if shutil.which("ffmpeg"):
        sheet = out_dir / "frame_contact_sheet.jpg"
        audio = out_dir / "audio.wav"
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video),
                "-vf",
                "fps=1/60,scale=240:-1,tile=8x1",
                str(sheet),
            ],
            required=False,
        )
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(audio),
            ],
            required=False,
        )
        if sheet.exists():
            result["frame_contact_sheet"] = str(sheet)
        if audio.exists():
            result["audio"] = str(audio)
    return result


def write_capture_report(out_dir: Path, note: dict[str, Any], final_url: str, url: str, transcript: dict[str, Any], media: dict[str, Any]) -> None:
    title = note.get("title") or "Untitled Xiaohongshu video"
    note_id = note.get("noteId") or out_dir.name.replace("xhs_", "")
    lines = [
        "# XHS Video Capture Report",
        "",
        f"Source URL: {url}",
        f"Resolved URL: {final_url}",
        f"Note ID: `{note_id}`",
        f"Title: {title}",
        f"Transcript status: `{transcript.get('status')}`",
        f"Transcript items: {transcript.get('items', 0)}",
        f"Local video: `{media.get('video')}`",
        "",
        "Write the final user-facing summary after reading `transcript_by_minute.md`, `transcript_with_timestamps.md`, and checking `frame_contact_sheet.jpg` when available.",
    ]
    (out_dir / "capture_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture Xiaohongshu/RedNote video artifacts.")
    parser.add_argument("url", help="xhslink.com or xiaohongshu.com video URL")
    parser.add_argument("--output-root", default="outputs", help="Directory where xhs_<note_id> will be created")
    parser.add_argument("--skip-video", action="store_true", help="Only fetch metadata, subtitles, and transcripts")
    parser.add_argument("--save-html", action="store_true", help="Save raw page.html for debugging. It may contain signed URLs.")
    args = parser.parse_args()

    html, final_url = fetch_text(args.url)
    state = parse_initial_state(html)
    note = first_note_from_state(state)
    note_id = note.get("noteId") or f"unknown_{int(time.time())}"
    out_dir = Path(args.output_root) / f"xhs_{note_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.save_html:
        (out_dir / "page.html").write_text(html, encoding="utf-8")

    media_v2 = parse_media_v2(note)
    extracted = {
        "source_url": args.url,
        "resolved_url": final_url,
        "note_id": note_id,
        "title": note.get("title"),
        "desc": note.get("desc"),
        "user": note.get("user"),
        "tags": note.get("tagList"),
        "time": note.get("time"),
        "last_update_time": note.get("lastUpdateTime"),
        "interact_info": note.get("interactInfo"),
        "video": note.get("video"),
        "media_v2": media_v2,
    }
    (out_dir / "page_note_extracted.json").write_text(json.dumps(extracted, ensure_ascii=False, indent=2), encoding="utf-8")

    if not args.skip_video:
        download_with_ytdlp(args.url, out_dir)
    subtitles = download_subtitles(media_v2, out_dir)
    transcript = write_transcripts(out_dir)
    media = make_media_artifacts(out_dir)
    write_capture_report(out_dir, note, final_url, args.url, transcript, media)

    status = {
        "output_dir": str(out_dir),
        "note_id": note_id,
        "title": note.get("title"),
        "subtitle_count": len([item for item in subtitles if item.get("status") == "ok"]),
        "transcript": transcript,
        "media": media,
    }
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
