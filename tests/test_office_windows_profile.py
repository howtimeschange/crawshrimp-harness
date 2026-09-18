from pathlib import Path
from types import SimpleNamespace

import pytest
from core.office import render


def test_windows_profile_avoids_deep_job_path_and_is_removed_on_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(render, "sys", SimpleNamespace(platform="win32"))
    monkeypatch.setattr(render.tempfile, "tempdir", str(tmp_path))
    job = tmp_path / ("nested-session-" * 12) / ("a" * 32)
    with pytest.raises(RuntimeError):
        with render._conversion_profile(job) as first:
            with render._conversion_profile(job) as second:
                assert first != second
                assert first.parent == tmp_path
                assert second.parent == tmp_path
                assert first.is_dir() and second.is_dir()
                assert str(job) not in str(first)
            assert not second.exists()
            raise RuntimeError("conversion failed")
    assert not first.exists()


def test_non_windows_keeps_job_local_profile(monkeypatch, tmp_path):
    monkeypatch.setattr(render, "sys", SimpleNamespace(platform="darwin"))
    with render._conversion_profile(tmp_path) as profile:
        assert profile == tmp_path / "lo-profile"
