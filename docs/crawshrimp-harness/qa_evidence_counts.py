"""Count download outcomes without retaining workbook cells or paths."""

from PIL import Image


def summarize_report(rows):
    rows = iter(rows)
    header = list(next(rows, ()))
    name_column = header.index('文件名')
    result_column = header.index('下载结果')
    row_count = matched_count = downloaded_count = 0
    for row in rows:
        if any(value is not None for value in row):
            row_count += 1
            matched_count += bool(row[name_column])
            downloaded_count += row[result_column] == '已下载'
    return row_count, matched_count, downloaded_count


def report_totals(reports):
    return {
        'worksheets': len(reports),
        'rows': sum(report[0] for report in reports),
        'matched': sum(report[1] for report in reports),
        'downloaded': sum(report[2] for report in reports),
    }


def check_image(source):
    with Image.open(source) as image:
        image.load()
