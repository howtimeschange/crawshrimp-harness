#!/usr/bin/env python3
"""Capture Bilibili metadata, subtitles, chapters, and optional ASR evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


@dataclass
class CaptureContext:
    bvid: str
    out_dir: Path
    work_dir: Path
    canonical_url: str


def request_json(url: str, *, referer: str | None = None) -> dict[str, Any]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
        headers["Origin"] = "https://www.bilibili.com"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def request_bytes(url: str, *, referer: str, timeout: int = 120) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": referer,
            "Origin": "https://www.bilibili.com",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def save_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_bvid(value: str) -> str:
    match = re.search(r"(BV[0-9A-Za-z]+)", value)
    if match:
        return match.group(1)
    parsed = urllib.parse.urlparse(value)
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("bvid", "BV"):
        if query.get(key):
            return query[key][0]
    raise SystemExit(f"Could not find a BV id in: {value}")


def fmt_time(seconds: float | int) -> str:
    seconds = int(round(float(seconds)))
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def safe_name(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", value).strip(" .")
    return value or "bilibili-video"


def path_key(url: str) -> str:
    return Path(urllib.parse.urlparse(url).path).stem


def get_wbi_mixin_key(referer: str) -> str | None:
    try:
        nav = request_json("https://api.bilibili.com/x/web-interface/nav", referer=referer)
    except Exception:
        return None
    wbi_img = ((nav.get("data") or {}).get("wbi_img") or {})
    raw = path_key(wbi_img.get("img_url", "")) + path_key(wbi_img.get("sub_url", ""))
    if len(raw) < 64:
        return None
    return "".join(raw[index] for index in MIXIN_KEY_ENC_TAB)[:32]


def signed_wbi_url(endpoint: str, params: dict[str, Any], mixin_key: str) -> str:
    clean: dict[str, str] = {}
    for key, value in params.items():
        clean[key] = re.sub(r"[!'()*]", "", str(value))
    clean["wts"] = str(int(time.time()))
    query = urllib.parse.urlencode(sorted(clean.items()))
    clean["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return endpoint + "?" + urllib.parse.urlencode(clean)


def fetch_core(ctx: CaptureContext) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    view_url = f"https://api.bilibili.com/x/web-interface/view?bvid={ctx.bvid}"
    view = request_json(view_url, referer=ctx.canonical_url)
    save_json(ctx.out_dir / "view.json", view)
    data = view.get("data") or {}
    cid = data.get("cid")
    if not cid:
        raise RuntimeError("Bilibili view API did not return cid.")
    pagelist = request_json(
        f"https://api.bilibili.com/x/player/pagelist?bvid={ctx.bvid}",
        referer=ctx.canonical_url,
    )
    save_json(ctx.out_dir / "pagelist.json", pagelist)
    player = request_json(
        f"https://api.bilibili.com/x/player/v2?bvid={ctx.bvid}&cid={cid}",
        referer=ctx.canonical_url,
    )
    save_json(ctx.out_dir / "player_v2.json", player)
    return view, pagelist, player


def try_ai_conclusion(ctx: CaptureContext, view: dict[str, Any]) -> None:
    data = view.get("data") or {}
    mixin_key = get_wbi_mixin_key(ctx.canonical_url)
    if not mixin_key:
        save_json(ctx.out_dir / "conclusion_get.json", {"status": "skipped", "reason": "missing_wbi_key"})
        return
    url = signed_wbi_url(
        "https://api.bilibili.com/x/web-interface/view/conclusion/get",
        {"bvid": ctx.bvid, "cid": data.get("cid"), "up_mid": ((data.get("owner") or {}).get("mid") or "")},
        mixin_key,
    )
    try:
        result = request_json(url, referer=ctx.canonical_url)
    except urllib.error.HTTPError as exc:
        result = {"status": "http_error", "code": exc.code, "reason": str(exc)}
    save_json(ctx.out_dir / "conclusion_get.json", result)


def fetch_subtitles(ctx: CaptureContext, player: dict[str, Any], *, authorized: bool) -> list[dict[str, Any]]:
    subtitle = ((player.get("data") or {}).get("subtitle") or {})
    items = subtitle.get("subtitles") or []
    manifest: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        url = item.get("subtitle_url") or item.get("url")
        if url and url.startswith("//"):
            url = "https:" + url
        entry = {
            "index": index,
            "id": item.get("id"),
            "lan": item.get("lan"),
            "lan_doc": item.get("lan_doc"),
            "has_url": bool(url),
        }
        if not url:
            manifest.append({**entry, "status": "missing_url"})
            continue
        try:
            body = request_json(url, referer=ctx.canonical_url)
        except Exception as exc:
            manifest.append({**entry, "status": "failed", "error": str(exc)})
            continue
        cues = body.get("body") or []
        manifest.append({**entry, "status": "ok", "cue_count": len(cues)})
        if authorized:
            prefix = f"subtitle_{safe_name(item.get('lan') or str(index))}"
            save_json(ctx.out_dir / f"{prefix}.json", body)
            write_transcripts_from_cues(ctx.out_dir, prefix, cues)
    save_json(ctx.out_dir / "subtitle_manifest.json", manifest)
    return manifest


def write_transcripts_from_cues(out_dir: Path, prefix: str, cues: list[dict[str, Any]]) -> None:
    srt_lines: list[str] = []
    md_lines: list[str] = []
    plain: list[str] = []
    for index, cue in enumerate(cues, 1):
        start = cue.get("from", 0)
        end = cue.get("to", start)
        text = str(cue.get("content") or "").strip()
        srt_lines.extend([str(index), f"{fmt_time(start)},000 --> {fmt_time(end)},000", text, ""])
        md_lines.append(f"[{fmt_time(start)} - {fmt_time(end)}] {text}")
        plain.append(text)
    (out_dir / f"{prefix}.srt").write_text("\n".join(srt_lines), encoding="utf-8")
    (out_dir / f"{prefix}_timestamps.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    (out_dir / f"{prefix}_plain.txt").write_text("".join(plain), encoding="utf-8")


def write_chapter_timeline(ctx: CaptureContext, player: dict[str, Any]) -> None:
    chapters = ((player.get("data") or {}).get("view_points") or [])
    lines = ["# Bilibili Official Chapters", "", f"Source: {ctx.canonical_url}", ""]
    if not chapters:
        lines.append("No official chapter markers were returned.")
    for chapter in chapters:
        lines.append(f"- {fmt_time(chapter.get('from', 0))}-{fmt_time(chapter.get('to', 0))}: {chapter.get('content', '')}")
    (ctx.out_dir / "timeline_chapters.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def fetch_playurl(ctx: CaptureContext, cid: int | str) -> dict[str, Any]:
    url = (
        "https://api.bilibili.com/x/player/playurl?"
        + urllib.parse.urlencode({"bvid": ctx.bvid, "cid": cid, "fnval": 4048, "fourk": 1})
    )
    playurl = request_json(url, referer=ctx.canonical_url)
    save_json(ctx.work_dir / "playurl_raw.json", playurl)
    dash = ((playurl.get("data") or {}).get("dash") or {})
    audio = dash.get("audio") or []
    video = dash.get("video") or []
    summary = {
        "code": playurl.get("code"),
        "message": playurl.get("message"),
        "audio_streams": [
            {key: item.get(key) for key in ("id", "bandwidth", "codecs", "mimeType")}
            for item in audio
        ],
        "video_streams": [
            {key: item.get(key) for key in ("id", "bandwidth", "codecs", "mimeType", "width", "height", "frameRate")}
            for item in video
        ],
    }
    save_json(ctx.out_dir / "playurl_summary.json", summary)
    return playurl


def download_audio(ctx: CaptureContext, playurl: dict[str, Any]) -> Path:
    audio_streams = (((playurl.get("data") or {}).get("dash") or {}).get("audio") or [])
    if not audio_streams:
        raise RuntimeError("No audio streams found in playurl response.")
    selected = max(audio_streams, key=lambda item: item.get("bandwidth") or 0)
    url = selected.get("baseUrl") or selected.get("base_url")
    if not url:
        raise RuntimeError("Selected audio stream has no baseUrl.")
    suffix = ".m4s"
    path = ctx.work_dir / f"audio_{selected.get('id', 'selected')}{suffix}"
    path.write_bytes(request_bytes(url, referer=ctx.canonical_url))
    save_json(
        ctx.out_dir / "audio_capture_summary.json",
        {"audio_id": selected.get("id"), "bandwidth": selected.get("bandwidth"), "bytes": path.stat().st_size},
    )
    return path


def locate_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def run_asr(ctx: CaptureContext, audio_path: Path, *, model_name: str, authorized: bool) -> None:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as exc:
        raise RuntimeError("Install faster-whisper to use --asr.") from exc
    ffmpeg = locate_ffmpeg()
    asr_input = audio_path
    wav_path = ctx.work_dir / "audio_16k.wav"
    if ffmpeg:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(audio_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(wav_path),
            ],
            check=True,
        )
        asr_input = wav_path
    started = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(asr_input), language="zh", beam_size=5, vad_filter=True)
    rows = [{"start": seg.start, "end": seg.end, "text": seg.text.strip()} for seg in segments]
    save_json(
        ctx.work_dir / "asr_segments_raw.json",
        {
            "engine": f"faster-whisper {model_name} cpu int8",
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "elapsed_seconds": round(time.time() - started, 1),
            "segments": rows,
        },
    )
    save_json(
        ctx.out_dir / "asr_stats.json",
        {
            "engine": f"faster-whisper {model_name} cpu int8",
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "segments": len(rows),
            "elapsed_seconds": round(time.time() - started, 1),
            "raw_asr_location": "work directory",
        },
    )
    if authorized:
        lines = [f"[{fmt_time(row['start'])} - {fmt_time(row['end'])}] {row['text']}" for row in rows]
        (ctx.out_dir / "asr_transcript_timestamps.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (ctx.out_dir / "asr_transcript_plain.txt").write_text("".join(row["text"] for row in rows), encoding="utf-8")


def write_sanitized_metadata(
    ctx: CaptureContext,
    view: dict[str, Any],
    player: dict[str, Any],
    subtitle_manifest: list[dict[str, Any]],
    *,
    used_asr: bool,
    authorized: bool,
) -> None:
    data = view.get("data") or {}
    owner = data.get("owner") or {}
    player_data = player.get("data") or {}
    metadata = {
        "source_url": ctx.canonical_url,
        "bvid": data.get("bvid") or ctx.bvid,
        "aid": data.get("aid"),
        "cid": data.get("cid"),
        "title": data.get("title"),
        "desc": data.get("desc"),
        "author": owner.get("name"),
        "author_mid": owner.get("mid"),
        "duration_seconds": data.get("duration"),
        "duration": fmt_time(data.get("duration") or 0),
        "pubdate": data.get("pubdate"),
        "subtitle_status": player_data.get("subtitle"),
        "subtitle_manifest": subtitle_manifest,
        "view_points": player_data.get("view_points") or [],
        "asr_used": used_asr,
        "authorized_verbatim": authorized,
    }
    save_json(ctx.out_dir / "metadata_sanitized.json", metadata)


def write_report(ctx: CaptureContext, view: dict[str, Any], subtitle_manifest: list[dict[str, Any]], *, used_asr: bool, authorized: bool) -> None:
    data = view.get("data") or {}
    subtitle_ok = [item for item in subtitle_manifest if item.get("status") == "ok"]
    lines = [
        "# Bilibili Capture Report",
        "",
        f"Source: {ctx.canonical_url}",
        f"Title: {data.get('title')}",
        f"Author: {(data.get('owner') or {}).get('name')}",
        f"BVID: `{ctx.bvid}`",
        f"Duration: {fmt_time(data.get('duration') or 0)}",
        "",
        "## Status",
        "",
        f"- Platform subtitle tracks: {len(subtitle_ok)}",
        f"- ASR used: {str(used_asr).lower()}",
        f"- Authorized verbatim output: {str(authorized).lower()}",
        "",
        "Use `metadata_sanitized.json` and `timeline_chapters.md` for user-facing summaries. "
        "Raw media, signed URLs, and raw ASR stay in the work directory.",
    ]
    (ctx.out_dir / "capture_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture Bilibili video transcript evidence.")
    parser.add_argument("url", help="Bilibili BV/AV URL or text containing a BV id")
    parser.add_argument("--output-root", default="outputs", help="Safe output root")
    parser.add_argument("--work-root", default="work", help="Private scratch root")
    parser.add_argument("--asr", action="store_true", help="Download audio and run faster-whisper ASR fallback")
    parser.add_argument("--model", default="small", help="faster-whisper model name for --asr")
    parser.add_argument("--authorized-verbatim", action="store_true", help="Write full transcript artifacts to output directory")
    parser.add_argument("--keep-raw-audio", action="store_true", help="Keep downloaded raw audio in work directory")
    args = parser.parse_args()

    bvid = parse_bvid(args.url)
    ctx = CaptureContext(
        bvid=bvid,
        out_dir=Path(args.output_root) / f"bilibili_{bvid}",
        work_dir=Path(args.work_root) / f"bilibili_{bvid}",
        canonical_url=f"https://www.bilibili.com/video/{bvid}/",
    )
    ctx.out_dir.mkdir(parents=True, exist_ok=True)
    ctx.work_dir.mkdir(parents=True, exist_ok=True)

    view, _pagelist, player = fetch_core(ctx)
    try_ai_conclusion(ctx, view)
    subtitle_manifest = fetch_subtitles(ctx, player, authorized=args.authorized_verbatim)
    write_chapter_timeline(ctx, player)

    used_asr = False
    audio_path: Path | None = None
    if args.asr:
        playurl = fetch_playurl(ctx, (view.get("data") or {}).get("cid"))
        audio_path = download_audio(ctx, playurl)
        run_asr(ctx, audio_path, model_name=args.model, authorized=args.authorized_verbatim)
        used_asr = True
        if audio_path and audio_path.exists() and not args.keep_raw_audio:
            audio_path.unlink()

    write_sanitized_metadata(
        ctx,
        view,
        player,
        subtitle_manifest,
        used_asr=used_asr,
        authorized=args.authorized_verbatim,
    )
    write_report(ctx, view, subtitle_manifest, used_asr=used_asr, authorized=args.authorized_verbatim)
    print(json.dumps({"output_dir": str(ctx.out_dir), "work_dir": str(ctx.work_dir), "asr_used": used_asr}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
