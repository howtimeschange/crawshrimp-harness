"""Collect publishable counts and checks for the September 10 walkthrough.

Read from the local QA environment, or pass --private-snapshot to regenerate
from the historical capture when that environment no longer exists.
"""
import argparse
from contextlib import closing
import io
import json
from pathlib import Path
import sqlite3
import sys
import zipfile

import openpyxl


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from qa_evidence_counts import check_image, report_totals, summarize_report

REPORT_MARKERS = ('QA-0910-full', '20260910-112624', '20260910-115640', '20260910-115732')


def summarize_zip(source):
    with zipfile.ZipFile(source) as archive:
        crc_ok = archive.testzip() is None
        image_count = 0
        if crc_ok:
            for item in archive.infolist():
                if not item.is_dir() and item.filename.lower().endswith(('.jpg', '.png')):
                    check_image(io.BytesIO(archive.read(item)))
                    image_count += 1
        return crc_ok, image_count


def evidence(source, run_statuses, reports, archives, image_count, image_job_complete,
             office_verified, exported_zip_verified, screenshot_recorded):
    return {
        'source': source,
        'database_mode': 'read-only',
        'script_runs': {'total': len(run_statuses), 'completed': run_statuses.count('done')},
        'match_reports': report_totals(reports),
        'zip_checks': {
            'archives': len(archives),
            'crc_passed': sum(crc_ok for crc_ok, _ in archives),
            'decoded_images': sum(count for _, count in archives),
        },
        'image_job_complete': image_job_complete,
        'decoded_downloaded_images': image_count,
        'office_summary_cache_verified': office_verified,
        'exported_zip_crc_verified': exported_zip_verified,
        'user_screenshot_recorded': screenshot_recorded,
    }


def collect_live(args):
    root = args.runtime_root.resolve()
    with closing(sqlite3.connect((root / 'crawshrimp.db').as_uri() + '?mode=ro', uri=True)) as db:
        runs = [row[0] for row in db.execute('SELECT status FROM task_runs WHERE id IN (11,12,13,14)')]
        job = db.execute('SELECT status FROM ai_image_jobs WHERE job_uid=?', (args.image_job_id,)).fetchone()

    reports = []
    archives = []
    artifact_dir = root / 'data' / 'semir-cloud-drive' / 'batch_image_download'
    for artifact in sorted(artifact_dir.iterdir()):
        if not artifact.is_file() or not any(marker in artifact.name for marker in REPORT_MARKERS):
            continue
        if artifact.suffix == '.zip':
            archives.append(summarize_zip(artifact))
        elif artifact.suffix == '.xlsx':
            workbook = openpyxl.load_workbook(artifact, read_only=True, data_only=True)
            with closing(workbook):
                reports.extend(summarize_report(sheet.values) for sheet in workbook)

    images = list((args.downloads / 'QA-0910-full-images').glob('*.png'))
    for image in images:
        check_image(image)
    export = args.downloads / 'QA-0910-full-export-copy.zip'
    export_ok = summarize_zip(export)[0] if export.is_file() else None
    with closing(openpyxl.load_workbook(args.office_workbook, read_only=True, data_only=True)) as workbook:
        office_ok = all(workbook['汇总'][f'B{row}'].value is not None for row in range(2, 8))
    return evidence('live', runs, reports, archives, len(images), job == ('completed',),
                    office_ok, export_ok, (HERE / 'G01-image-workbench-layout-user.png').is_file())


def summarize_private_snapshot(snapshot):
    runs = [run['status'] for run in snapshot['script_runs']]
    reports = [summarize_report(rows) for artifact in snapshot['script_artifacts']
               for rows in artifact.get('sheets', {}).values()]
    archives = [(artifact['crc_error'] is None, sum('image_size' in item for item in artifact['members']))
                for artifact in snapshot['script_artifacts'] if 'crc_error' in artifact]
    office = snapshot['office']['cached_summary']
    return evidence('historical_snapshot', runs, reports, archives,
                    sum(bool(image.get('format')) for image in snapshot['downloaded_images']),
                    snapshot['image_job']['status'] == 'completed',
                    all(office.get(f'B{row}') is not None for row in range(2, 8)),
                    None, bool(snapshot.get('user_screenshot')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--runtime-root', type=Path)
    source.add_argument('--private-snapshot', type=Path)
    parser.add_argument('--image-job-id')
    parser.add_argument('--office-workbook', type=Path)
    parser.add_argument('--downloads', type=Path, default=Path.home() / 'Downloads')
    parser.add_argument('--output', type=Path, default=HERE / 'evidence.json')
    args = parser.parse_args()
    if args.runtime_root and not (args.image_job_id and args.office_workbook):
        parser.error('--runtime-root requires --image-job-id and --office-workbook')
    try:
        if args.private_snapshot:
            result = summarize_private_snapshot(json.loads(args.private_snapshot.read_text(encoding='utf-8')))
        else:
            result = collect_live(args)
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    except Exception as error:
        # Source paths, cell values and errors from the walkthrough are private.
        parser.exit(1, f'Could not collect QA counts ({type(error).__name__}).\n')


if __name__ == '__main__':
    main()
