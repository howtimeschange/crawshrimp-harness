"""Read only the runs and image files used by this walkthrough regression."""
from pathlib import Path
import hashlib
import json
import sqlite3
from PIL import Image
import openpyxl

root = Path('/private/tmp/crawshrimp-harness-main-dev-20260907/runtime-data')
connection = sqlite3.connect(f'file:{root}/crawshrimp.db?mode=ro', uri=True)
connection.row_factory = sqlite3.Row
runs = [dict(row) for row in connection.execute(
    'SELECT id,status,records_count,output_files FROM task_runs WHERE id BETWEEN 15 AND 19 ORDER BY id')]
for run in runs:
    run['output_files'] = json.loads(run['output_files'])
    run['sheets'] = []
    for filename in run['output_files']:
        if filename.endswith('.xlsx'):
            workbook = openpyxl.load_workbook(filename, data_only=True)
            rows = list(workbook.active.values)
            run['sheets'].append({'file': filename, 'rows': rows})
jobs = [dict(row) for row in connection.execute(
    'SELECT job_uid,title,status,prompt FROM ai_image_jobs WHERE job_uid IN (?,?)',
    ('9ef61bca9d6d47d3810ebada8519ead2', 'caeffe9b03b74366a44d2933e40685c2'))]
images = []
for file in sorted(Path('/private/tmp/crawshrimp-walkthrough-fix/download-after').glob('*.png')):
    with Image.open(file) as image:
        image.load()
        images.append({'file': str(file), 'bytes': file.stat().st_size,
                       'size': list(image.size), 'decoded': True,
                       'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
evidence = {'database_mode': 'read-only', 'runs': runs, 'jobs': jobs, 'images': images}
Path(__file__).with_name('evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'runs': [(run['id'], run['status'], run['records_count']) for run in runs],
                  'images_decoded': len(images), 'job_statuses': [job['status'] for job in jobs]}, ensure_ascii=False))
