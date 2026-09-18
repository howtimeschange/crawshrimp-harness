"""Reuse verified rendering within one session; never reuse a visual approval."""
import hashlib
import json
import shutil
from pathlib import Path
from .runtime import assets, office_root, file_hash, OfficeError


def cache_key(document, recalculate, expected):
    # Recalculation can depend on time/external state; always execute it anew.
    if recalculate:
        return None
    try:
        manifest = assets()
        root = office_root()
        stamps = []
        for item in [manifest['executable'], *manifest.get('fonts', [])]:
            path = root / item['path']; stat = path.stat()
            stamps.append((item['path'], stat.st_size, stat.st_mtime_ns))
        payload = [file_hash(document), document.name, document.suffix.lower(), expected, manifest, stamps, 'render-cache-v1']
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    except (OSError, KeyError, TypeError, OfficeError):
        return None


def restore(root: Path, work: Path, key: str | None, cancel=None):
    if not key:
        return None
    # Only the current session's newest 20 jobs, bounded even with long histories.
    import heapq
    def history():
        try:
            for path in root.iterdir():
                try:
                    if path != work and path.is_dir():
                        yield path.stat().st_mtime_ns, path
                except OSError:
                    continue  # History may be removed while this job starts.
        except OSError:
            return  # An optional cache must not prevent a fresh render.
    candidates = heapq.nlargest(20, history(), key=lambda row: row[0])
    for _, previous in candidates:
        try:
            data = json.loads((previous / 'manifest.json').read_text(encoding='utf-8'))
            if data.get('state') != 'completed' or data.get('render_cache_key') != key:
                continue
            result = data['result']
            owned = [result['document'], result['pdf'], result['contact_sheet'], *[p['path'] for p in result['pages']]]
            if any(not Path(p).resolve().is_relative_to(previous.resolve()) or not Path(p).is_file() for p in owned):
                continue
            if file_hash(Path(result['document'])) != result['revision']:
                continue
            if any(file_hash(Path(p['path'])) != p['sha256'] for p in result['pages']):
                continue
            # Require digests for every cached file, not just the image pages.
            digests = data.get('render_cache_files') or {}
            if any(digests.get(str(Path(p).relative_to(previous))) != file_hash(Path(p)) for p in owned):
                continue
            translated = {}
            for source in owned:
                if cancel and cancel.is_set():
                    return None
                dest = work / Path(source).relative_to(previous)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
                translated[source] = str(dest)
            result = json.loads(json.dumps(result))
            for field in ('document', 'pdf', 'contact_sheet'):
                result[field] = translated[result[field]]
            for page in result['pages']:
                page['path'] = translated[page['path']]
            if isinstance(result.get('validation'), dict):
                result['validation']['path'] = result['document']
            result['visual'] = {'status': 'not_run', 'reviewed': [], 'total': len(result['pages'])}
            result['cache_hit'] = True
            from .reports import write_report
            write_report(work, result)
            (work / 'result.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            return result
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return None


def file_digests(work, result):
    paths = [result['document'], result['pdf'], result['contact_sheet'], *[p['path'] for p in result['pages']]]
    return {str(Path(p).relative_to(work)): file_hash(Path(p)) for p in paths}
