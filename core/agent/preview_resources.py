"""Bounded relative resources for static previews; no changes to general artifact access."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import base64
from fastapi import HTTPException

TYPES = {'.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
         '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
         '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf'}
MAX_RESOURCE_BYTES = 8 * 1024 * 1024


def read_preview_resource(document: str, relative: str) -> dict:
    doc = Path(document).expanduser().resolve()
    if not doc.is_file() or doc.suffix.lower() not in {'.html', '.htm', '.md', '.markdown'}:
        raise HTTPException(400, '仅支持 HTML / Markdown 文档的相对资源')
    url = urlsplit(relative)
    raw = unquote(url.path)
    if url.scheme or url.netloc or not raw or raw.startswith(('/', '\\')) or '\\' in raw or '\x00' in raw:
        raise HTTPException(400, '仅支持文档目录内的相对路径')
    root = doc.parent
    target = (root / raw).resolve()
    if not target.is_relative_to(root):
        raise HTTPException(403, '资源超出文档目录')
    mime = TYPES.get(target.suffix.lower())
    if not mime:
        raise HTTPException(415, '不支持此资源类型')
    try:
        # Bounded even when the file grows between stat and read.
        with target.open('rb') as f:
            data = f.read(MAX_RESOURCE_BYTES + 1)
    except (OSError, ValueError) as exc:
        raise HTTPException(404, '资源不存在或无法读取') from exc
    if len(data) > MAX_RESOURCE_BYTES:
        raise HTTPException(413, '单个预览资源不能超过 8 MB')
    return {'mime': mime, 'bytes': len(data), 'data': base64.b64encode(data).decode('ascii')}
