from pathlib import Path
from zipfile import ZipFile
import importlib

import pytest

from core.office.templates import word_template, ppt_template, excel_template


@pytest.mark.parametrize('extension,create', [('docx', word_template), ('pptx', ppt_template), ('xlsx', excel_template)])
def test_render_uses_localized_font_fallbacks_only_in_preview_input(tmp_path, monkeypatch, extension, create):
    import pymupdf
    rendering = importlib.import_module('core.office.render')
    source = tmp_path / f'source.{extension}'
    create(source)
    original = source.read_bytes()
    work = tmp_path / 'job'
    work.mkdir()
    monkeypatch.setattr(rendering, 'assets', lambda: {'executable': {'path': 'soffice'}, 'libreofficeVersion': 'fixture'})
    monkeypatch.setattr(rendering, 'office_root', lambda: tmp_path)
    inputs = []

    def convert(command, *args, **kwargs):
        preview_input = Path(command[-1])
        inputs.append(preview_input)
        assert preview_input.parent.name == 'render-input'
        with ZipFile(preview_input) as package:
            xml = b'\n'.join(package.read(name) for name in package.namelist() if name.endswith('.xml'))
        assert 'Source Han Sans SC;思源黑体'.encode() in xml
        destination = Path(command[command.index('--outdir') + 1]) / (preview_input.stem + '.pdf')
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((20, 20), 'Preview fixture')
            pdf.save(destination)
        return {'stdout': '', 'stderr': ''}

    monkeypatch.setattr(rendering, 'execute', convert)
    result = rendering.render(source, work)
    assert len(inputs) == 1
    assert len(result['pages']) == 1
    assert Path(result['document']).parent.name == 'editable'
    assert Path(result['document']).read_bytes() == original
    assert source.read_bytes() == original
