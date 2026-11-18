"""Collect publishable counts for the September 10 regression checks."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from qa_evidence_counts import check_image, report_totals, summarize_report


def evidence(source, run_statuses, reports, job_statuses, decoded_images):
    return {
        'source': source,
        'database_mode': 'read-only',
        'script_runs': {
            'total': len(run_statuses),
            'completed': run_statuses.count('done'),
            'stopped': run_statuses.count('stopped'),
        },
        'match_reports': report_totals(reports),
        'image_jobs': {'total': len(job_statuses), 'draft': job_statuses.count('draft')},
        'decoded_downloaded_images': decoded_images,
    }


def collect_live(args):
    with closing(sqlite3.connect((args.runtime_root.resolve() / 'crawshrimp.db').as_uri() + '?mode=ro', uri=True)) as db:
        runs = db.execute('SELECT status, output_files FROM task_runs WHERE id BETWEEN 15 AND 19').fetchall()
        jobs = db.execute('SELECT status FROM ai_image_jobs WHERE job_uid IN (?, ?)', args.image_job_ids).fetchall()
    reports = []
    for _, files in runs:
        for filename in json.loads(files):
            if filename.endswith('.xlsx'):
                with closing(openpyxl.load_workbook(filename, read_only=True, data_only=True)) as workbook:
                    reports.append(summarize_report(workbook.active.values))
    images = list(args.images_dir.glob('*.png'))
    for image in images:
        check_image(image)
    return evidence('live', [status for status, _ in runs], reports, [job[0] for job in jobs], len(images))


def summarize_private_snapshot(snapshot):
    return evidence(
        'historical_snapshot',
        [run['status'] for run in snapshot['runs']],
        [summarize_report(sheet['rows']) for run in snapshot['runs'] for sheet in run['sheets']],
        [job['status'] for job in snapshot['jobs']],
        sum(image['decoded'] is True for image in snapshot['images']),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--runtime-root', type=Path)
    source.add_argument('--private-snapshot', type=Path)
    parser.add_argument('--image-job-ids', nargs=2)
    parser.add_argument('--images-dir', type=Path)
    parser.add_argument('--output', type=Path, default=HERE / 'evidence.json')
    args = parser.parse_args()
    if args.runtime_root and not (args.image_job_ids and args.images_dir):
        parser.error('--runtime-root requires --image-job-ids and --images-dir')
    try:
        if args.private_snapshot:
            result = summarize_private_snapshot(json.loads(args.private_snapshot.read_text(encoding='utf-8')))
        else:
            result = collect_live(args)
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    except Exception as error:
        parser.exit(1, f'Could not collect QA counts ({type(error).__name__}).\n')


if __name__ == '__main__':
    main()
