from types import SimpleNamespace

from core.agent import office_tools
from core.office.artifacts import is_office_working_image, publication_files


def test_office_publishes_documents_without_working_images(tmp_path, monkeypatch):
    paths = [tmp_path / name for name in ('deck.pptx', 'handout.pdf', '_fit/icon.png', 'preview/page-1.png')]
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'file')
    emitted = []
    gw = SimpleNamespace(ctx=SimpleNamespace(current_tool_call_id='call', emit_event=lambda *args: emitted.append(args)))
    monkeypatch.setattr(office_tools, 'gateway', lambda: gw)
    monkeypatch.setattr(office_tools, 'root', lambda: tmp_path)
    result = {'files': [str(p) for p in paths]}
    office_tools.publish({'job_id': 'run', 'result': result})
    assert [event[1]['filename'] for event in emitted] == ['deck.pptx', 'handout.pdf']
    assert len(result['files']) == 4  # Assets remain available for scripts/rendering.


def test_render_publishes_only_reviewed_document():
    assert publication_files({'document': '/editable/deck.pptx', 'files': ['/preview/page.png', '/preview/deck.pdf']}) == ['/editable/deck.pptx']


def test_image_delivery_is_not_hidden_by_office_compatibility_rule():
    assert not is_office_working_image({'filename': 'final.png', 'source': 'adapter'})
    assert not is_office_working_image({'filename': 'final.png', 'office': {'delivery': {'status': 'final'}}})
    assert is_office_working_image({'source': 'office', 'filename': 'icon.png', 'path': ''})
