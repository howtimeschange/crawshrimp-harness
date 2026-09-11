"""Cloud approval is a retired compatibility API, never a remote executor."""
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from core import api_server


class RetiredCloudApiTests(unittest.TestCase):
    def test_old_enabled_config_cannot_restart_a_machine(self):
        with patch.object(api_server, 'load_config', return_value={'cloud_approval': {'machine_enabled': True}}), \
             patch.object(api_server.cloud_machine_controller, 'start') as start, \
             patch.object(api_server, 'resolve_cloud_approval_url') as resolve:
            self.assertFalse(api_server._start_cloud_machine_if_enabled())
            start.assert_not_called()
            resolve.assert_not_called()

    def test_status_neither_reads_credentials_nor_probes_cloud(self):
        with patch.object(api_server, 'resolve_cloud_approval_url') as resolve, \
             patch.object(api_server.data_sink, 'get_cloud_machine_credentials') as credentials:
            state = api_server.get_cloud_approval_status(refresh=True)
            self.assertTrue(state['deprecated'])
            for field in ['configured', 'running', 'machine_enabled', 'token_present']:
                self.assertFalse(state[field])
            resolve.assert_not_called()
            credentials.assert_not_called()

    def test_all_legacy_write_and_cloud_read_entrypoints_fail_closed(self):
        calls = [
            (api_server.configure_cloud_approval, (None,)),
            (api_server.enroll_cloud_machine, (None,)),
            (api_server.sync_cloud_approval_batch, (None,)),
            (api_server.start_cloud_machine, ()),
            (api_server.get_cloud_prompt_libraries, ()),
            (api_server.get_cloud_prompt_templates, ('1',)),
            (api_server.get_cloud_prompt_library_export, ('1',)),
            (api_server._build_cloud_client, ()),
        ]
        with patch.object(api_server, 'patch_config') as persist, \
             patch.object(api_server, 'CloudApprovalClient') as client:
            for function, args in calls:
                with self.subTest(function=function.__name__), self.assertRaises(HTTPException) as caught:
                    function(*args)
                self.assertEqual(caught.exception.status_code, 410)
            persist.assert_not_called()
            client.assert_not_called()

    def test_controller_cannot_be_started_by_internal_callers(self):
        with self.assertRaisesRegex(RuntimeError, 'retired'):
            api_server.CloudMachineLoopController().start(object())

    def test_settings_do_not_expose_or_accept_legacy_credentials(self):
        with patch.object(api_server, 'load_config', return_value={"cloud_approval": {"registration_token": "secret", "machine_enabled": True}}):
            self.assertNotIn('cloud_approval', api_server.get_settings())
            patch_data = api_server._safe_settings_write_patch({"cloud_approval.machine_enabled": True, "cloud_approval": {"registration_token": "secret"}})
            self.assertFalse(any(key.startswith('cloud_approval') for key in patch_data))

    def test_stop_remains_available_without_cloud_access(self):
        with patch.object(api_server.cloud_machine_controller, 'stop') as stop:
            self.assertTrue(api_server.stop_cloud_machine()['ok'])
            stop.assert_called_once()


if __name__ == '__main__':
    unittest.main()
