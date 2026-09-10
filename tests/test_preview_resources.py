import base64
import pytest
from fastapi import HTTPException
from core.agent.preview_resources import read_preview_resource, MAX_RESOURCE_BYTES

@pytest.fixture
def doc(tmp_path):
    root = tmp_path / 'document'; root.mkdir()
    path = root / 'index.html'; path.write_text('<h1>test</h1>')
    (root / 'assets').mkdir(); (root / 'assets' / '图 a.png').write_bytes(b'picture')
    (tmp_path / 'private.png').write_bytes(b'secret')
    (root / 'escape.png').symlink_to(tmp_path / 'private.png')
    return path

def test_relative_encoded_unicode(doc):
    result = read_preview_resource(str(doc), 'assets/%E5%9B%BE%20a.png?v=1#x')
    assert result['mime'] == 'image/png'
    assert base64.b64decode(result['data']) == b'picture'

@pytest.mark.parametrize('relative', ['../private.png', '%2e%2e/private.png', 'escape.png', '/etc/passwd', 'https://evil/image.png', '//evil/a.png', 'file:///tmp/a.png', 'assets\\a.png', 'data:image/png,hello'])
def test_escape_and_external_blocked(doc, relative):
    with pytest.raises(HTTPException): read_preview_resource(str(doc), relative)

def test_missing_type_and_oversized(doc):
    with pytest.raises(HTTPException) as e: read_preview_resource(str(doc), 'missing.png')
    assert e.value.status_code == 404
    (doc.parent / 'secret.json').write_text('{}')
    with pytest.raises(HTTPException) as e: read_preview_resource(str(doc), 'secret.json')
    assert e.value.status_code == 415
    (doc.parent / 'huge.png').write_bytes(b'x' * (MAX_RESOURCE_BYTES + 1))
    with pytest.raises(HTTPException) as e: read_preview_resource(str(doc), 'huge.png')
    assert e.value.status_code == 413
