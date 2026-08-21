import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import api_server, atomic_file, data_sink, runtime_paths


class _FakeHandle:
    def __init__(self):
        self.closed = False

    def Close(self):
        self.closed = True


class _FakeAcl:
    def __init__(self):
        self.entries = []

    def AddAccessAllowedAceEx(self, revision, flags, access, sid):
        self.entries.append((revision, flags, access, sid))


class _FakeSecurityDescriptor:
    def __init__(self):
        self.dacl = None

    def SetSecurityDescriptorDacl(self, present, dacl, defaulted):
        self.dacl = (present, dacl, defaulted)


class _FakeWin32Security:
    ACL_REVISION_DS = 4
    DACL_SECURITY_INFORMATION = 0x00000004
    PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    TokenUser = 1
    WinLocalSystemSid = 22
    WinBuiltinAdministratorsSid = 26

    def __init__(self):
        self.handle = _FakeHandle()
        self.applied = []

    def ACL(self):
        return _FakeAcl()

    def SECURITY_DESCRIPTOR(self):
        return _FakeSecurityDescriptor()

    def OpenProcessToken(self, _process, _access):
        return self.handle

    def GetTokenInformation(self, _token, info_class):
        assert info_class == self.TokenUser
        return ("current-user-sid", 0)

    def CreateWellKnownSid(self, sid_kind, _domain):
        return f"well-known-{sid_kind}"

    def SetFileSecurity(self, path, flags, descriptor):
        self.applied.append((path, flags, descriptor))


class _FakeWin32Api:
    @staticmethod
    def GetCurrentProcess():
        return "current-process"


class _FakeWin32Con:
    TOKEN_QUERY = 0x0008
    OBJECT_INHERIT_ACE = 0x1
    CONTAINER_INHERIT_ACE = 0x2


class _FakeNtSecurityCon:
    FILE_ALL_ACCESS = 0x1F01FF


class _FakeStat:
    st_dev = 10
    st_ino = 20

    def __init__(self, *, ctime_ns, mtime_ns, size):
        self.st_ctime_ns = ctime_ns
        self.st_mtime_ns = mtime_ns
        self.st_size = size


class _FakePathWithStat:
    def __init__(self, metadata):
        self._metadata = metadata

    def stat(self, *, follow_symlinks=False):
        if follow_symlinks is not False:
            raise AssertionError("Windows ACL identity must not follow symlinks")
        return self._metadata


class WindowsAclTests(unittest.TestCase):
    def _load_module(self):
        try:
            from core import windows_acl
        except ImportError as exc:
            self.fail(f"Windows ACL hardening module is missing: {exc}")
        return windows_acl

    def test_pywin32_dacl_is_protected_and_limited_to_current_user_system_and_admins(self):
        windows_acl = self._load_module()
        security = _FakeWin32Security()
        modules = (security, _FakeWin32Api(), _FakeWin32Con(), _FakeNtSecurityCon())
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(windows_acl, "_is_windows", return_value=True):
                with patch.object(windows_acl, "_load_pywin32", return_value=modules):
                    self.assertTrue(windows_acl.harden_windows_path(Path(tmpdir)))

        self.assertTrue(security.handle.closed)
        self.assertEqual(len(security.applied), 1)
        _path, flags, descriptor = security.applied[0]
        self.assertEqual(
            flags,
            security.DACL_SECURITY_INFORMATION | security.PROTECTED_DACL_SECURITY_INFORMATION,
        )
        present, dacl, defaulted = descriptor.dacl
        self.assertEqual((present, defaulted), (True, False))
        self.assertEqual(
            [entry[3] for entry in dacl.entries],
            ["current-user-sid", "well-known-22", "well-known-26"],
        )
        inheritance = _FakeWin32Con.OBJECT_INHERIT_ACE | _FakeWin32Con.CONTAINER_INHERIT_ACE
        self.assertTrue(all(entry[1] == inheritance for entry in dacl.entries))
        self.assertTrue(all(entry[2] == _FakeNtSecurityCon.FILE_ALL_ACCESS for entry in dacl.entries))

    def test_repeated_runtime_path_checks_do_not_reapply_the_same_windows_dacl(self):
        windows_acl = self._load_module()
        security = _FakeWin32Security()
        modules = (security, _FakeWin32Api(), _FakeWin32Con(), _FakeNtSecurityCon())
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(windows_acl, "_is_windows", return_value=True):
                with patch.object(windows_acl, "_load_pywin32", return_value=modules):
                    self.assertTrue(windows_acl.harden_windows_path(Path(tmpdir)))
                    self.assertTrue(windows_acl.harden_windows_path(Path(tmpdir)))

        self.assertEqual(len(security.applied), 1)

    def test_file_identity_distinguishes_replacement_when_inode_is_reused(self):
        windows_acl = self._load_module()

        old_identity = windows_acl._file_identity(
            _FakePathWithStat(_FakeStat(ctime_ns=100, mtime_ns=100, size=3))
        )
        replacement_identity = windows_acl._file_identity(
            _FakePathWithStat(_FakeStat(ctime_ns=200, mtime_ns=200, size=11))
        )

        self.assertNotEqual(old_identity, replacement_identity)

    def test_replaced_file_at_same_path_receives_a_fresh_windows_dacl(self):
        windows_acl = self._load_module()
        security = _FakeWin32Security()
        modules = (security, _FakeWin32Api(), _FakeWin32Con(), _FakeNtSecurityCon())
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "state.json"
            target.write_text("old", encoding="utf-8")
            with patch.object(windows_acl, "_is_windows", return_value=True):
                with patch.object(windows_acl, "_load_pywin32", return_value=modules):
                    self.assertTrue(windows_acl.harden_windows_path(target))
                    target.unlink()
                    target.write_text("replacement", encoding="utf-8")
                    self.assertTrue(windows_acl.harden_windows_path(target))

        self.assertEqual(len(security.applied), 2)

    def test_atomic_write_works_when_runtime_has_no_fchmod(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "windows-state.json"
            with patch.object(atomic_file.os, "fchmod", None, create=True):
                atomic_file.atomic_write_json(target, {"ok": True})

            self.assertEqual(target.read_text(encoding="utf-8"), '{\n  "ok": true\n}\n')

    def test_atomic_write_retries_locked_temporary_file_cleanup(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            target = root / "state.json"
            target.write_text('{"stable": true}\n', encoding="utf-8")
            original_unlink = Path.unlink
            cleanup_attempts = 0

            def interrupted_dump(_payload, handle, **_kwargs):
                handle.write('{"partial":')
                handle.flush()
                raise OSError("simulated interrupted write")

            def transient_unlink(path, *args, **kwargs):
                nonlocal cleanup_attempts
                if path.name.endswith(".tmp"):
                    cleanup_attempts += 1
                    if cleanup_attempts == 1:
                        error = PermissionError("[WinError 32] sharing violation")
                        error.winerror = 32
                        raise error
                return original_unlink(path, *args, **kwargs)

            with patch.object(atomic_file.json, "dump", side_effect=interrupted_dump), \
                    patch.object(Path, "unlink", transient_unlink):
                with self.assertRaisesRegex(OSError, "interrupted write"):
                    atomic_file.atomic_write_json(target, {"stable": False})

            self.assertEqual(cleanup_attempts, 2)
            self.assertEqual(target.read_text(encoding="utf-8"), '{"stable": true}\n')
            self.assertEqual([path.name for path in root.iterdir()], ["state.json"])

    def test_runtime_directory_preparation_applies_platform_acl_hardening(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "runtime"
            with patch.object(
                runtime_paths,
                "assert_no_reparse_components_windows",
                side_effect=lambda path, **_kwargs: Path(path),
                create=True,
            ) as no_reparse:
                with patch.object(runtime_paths, "harden_windows_path", create=True) as harden:
                    runtime_paths._ensure_dir(target)

        self.assertEqual(no_reparse.call_count, 2)
        self.assertTrue(no_reparse.call_args_list[0].kwargs["allow_missing"])
        harden.assert_called_once_with(target)

    def test_windows_data_root_rejects_a_reparse_parent_before_creating_children(self):
        windows_acl = self._load_module()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir).resolve()
            outside = root / "outside"
            outside.mkdir()
            link = root / "junction"
            link.symlink_to(outside, target_is_directory=True)
            requested = link / "crawshrimp"

            with patch.object(windows_acl, "_is_windows", return_value=True):
                with self.assertRaises(windows_acl.WindowsAclError):
                    windows_acl.assert_no_reparse_components_windows(
                        requested,
                        allow_missing=True,
                    )

            self.assertFalse((outside / "crawshrimp").exists())

    def test_windows_data_root_rejects_filesystem_and_user_roots(self):
        windows_acl = self._load_module()
        with patch.object(windows_acl, "_is_windows", return_value=True):
            with self.assertRaises(windows_acl.WindowsAclError):
                windows_acl.assert_safe_windows_data_root(Path(Path.cwd().anchor))
            with self.assertRaises(windows_acl.WindowsAclError):
                windows_acl.assert_safe_windows_data_root(Path.home())
            with self.assertRaises(windows_acl.WindowsAclError):
                windows_acl.assert_safe_windows_data_root(Path.home().parent)

            dedicated = Path.home() / "AppData" / "Local" / "crawshrimp"
            self.assertEqual(
                windows_acl.assert_safe_windows_data_root(dedicated),
                dedicated.absolute(),
            )

    def test_standalone_api_token_is_atomic_and_acl_hardened(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with patch.dict(os.environ, {}, clear=True):
                with patch.object(api_server, "_backend_lock_dir", return_value=root):
                    with patch.object(Path, "write_text", side_effect=AssertionError("live token truncation")):
                        with patch.object(
                            api_server,
                            "atomic_write_text",
                            wraps=atomic_file.atomic_write_text,
                            create=True,
                        ) as atomic_write:
                            with patch.object(api_server, "harden_windows_path", create=True) as harden:
                                token = api_server._get_api_token()

            self.assertEqual(len(token), 64)
            self.assertEqual((root / "api-token").read_text(encoding="utf-8"), token)
            atomic_write.assert_called_once()
            harden.assert_called_once_with(root / "api-token")

    def test_sqlite_and_sidecars_receive_windows_dacls(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "crawshrimp.db"
            files = [db_path, Path(f"{db_path}-wal"), Path(f"{db_path}-shm"), Path(f"{db_path}-journal")]
            for file_path in files:
                file_path.write_bytes(b"")

            with patch.object(data_sink, "_db_path", return_value=db_path):
                with patch.object(data_sink.os, "name", "nt"):
                    with patch.object(data_sink, "harden_windows_path", create=True) as harden:
                        data_sink._harden_db_file_permissions()

        self.assertEqual(
            [call.args[0] for call in harden.call_args_list],
            [db_path.parent, *files],
        )


if __name__ == "__main__":
    unittest.main()
