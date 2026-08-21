import unittest
import json
from copy import deepcopy
from unittest.mock import patch

from core.config import DEFAULT_CONFIG, load_config, patch_config, save_config


class AiSettingsConfigTests(unittest.TestCase):
    def test_default_config_exposes_1xm_keys_without_real_secret_values(self):
        one_xm = DEFAULT_CONFIG["ai"]["1xm"]

        self.assertEqual(one_xm["gpt_image_2k_key"], "")
        self.assertEqual(one_xm["gpt_image_4k_key"], "")
        self.assertEqual(one_xm["gemini_3_1_flash_image_preview_key"], "")
        self.assertEqual(one_xm["gemini_3_pro_image_preview_key"], "")
        self.assertEqual(one_xm["base_url"], "https://one-xm-proxy.crawshrimp.com/v1")
        self.assertEqual(DEFAULT_CONFIG["notify"]["dingtalk_secret"], "")

    def test_load_config_migrates_legacy_1xm_default_base_url_to_proxy(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({"ai.1xm.base_url": "https://api.1xm.ai/v1"})

                loaded = load_config()

        self.assertEqual(loaded["ai"]["1xm"]["base_url"], "https://one-xm-proxy.crawshrimp.com/v1")

    def test_load_config_preserves_custom_1xm_base_url(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({"ai.1xm.base_url": "https://custom-proxy.example/v1"})

                loaded = load_config()

        self.assertEqual(loaded["ai"]["1xm"]["base_url"], "https://custom-proxy.example/v1")

    def test_default_config_exposes_video_provider_fields_without_secret_values(self):
        video = DEFAULT_CONFIG["ai"]["video"]

        self.assertEqual(video["seedance_api_key"], "")
        self.assertEqual(video["bailian_api_key"], "")
        self.assertEqual(video["bailian_workspace_id"], "")
        self.assertEqual(video["bailian_region"], "cn-beijing")
        self.assertEqual(video["bailian_upload_api_key"], "")
        self.assertEqual(video["bailian_uploads_url"], "https://dashscope.aliyuncs.com/api/v1/uploads")

    def test_default_config_exposes_llm_routes_without_a_real_secret(self):
        llm = DEFAULT_CONFIG["ai"]["llm"]

        self.assertEqual(llm["api_key"], "")
        self.assertEqual(llm["deepseek_api_key"], "")
        self.assertEqual(llm["overseas_openai_base_url"], "https://ai-aigw.semir.com/overseas-openai-vip/v1")
        self.assertEqual(llm["overseas_anthropic_base_url"], "https://ai-aigw.semir.com/overseas-anthropic-vip")
        self.assertEqual(llm["domestic_base_url"], "https://ai-aigw.semir.com/bailian-codingplan/v1")
        self.assertEqual(llm["deepseek_base_url"], "https://api.deepseek.com")
        self.assertEqual(llm["default_model"], "deepseek-official-v4-flash")

    def test_save_config_expands_dotted_settings_keys(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({
                    "ai.1xm.gpt_image_2k_key": "unit-2k",
                    "ai.1xm.gemini_3_1_flash_image_preview_key": "unit-flash",
                    "ai.1xm.gemini_3_pro_image_preview_key": "unit-pro",
                    "notify.dingtalk_webhook": "https://example.test/hook",
                    "notify.dingtalk_secret": "unit-secret",
                })
                loaded = load_config()

        self.assertEqual(loaded["ai"]["1xm"]["gpt_image_2k_key"], "unit-2k")
        self.assertEqual(loaded["ai"]["1xm"]["gemini_3_1_flash_image_preview_key"], "unit-flash")
        self.assertEqual(loaded["ai"]["1xm"]["gemini_3_pro_image_preview_key"], "unit-pro")
        self.assertEqual(loaded["notify"]["dingtalk_webhook"], "https://example.test/hook")
        self.assertEqual(loaded["notify"]["dingtalk_secret"], "unit-secret")

    def test_patch_config_updates_only_targeted_settings(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({
                    "notify.dingtalk_webhook": "https://example.test/old",
                    "notify.feishu_webhook": "https://open.feishu.cn/old",
                    "data_dir": "/tmp/crawshrimp-data",
                })
                patch_config({
                    "notify.dingtalk_webhook": "https://example.test/new",
                })
                loaded = load_config()

        self.assertEqual(loaded["notify"]["dingtalk_webhook"], "https://example.test/new")
        self.assertEqual(loaded["notify"]["feishu_webhook"], "https://open.feishu.cn/old")
        self.assertEqual(loaded["data_dir"], "/tmp/crawshrimp-data")

    def test_failed_save_keeps_the_previous_config_intact(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text('{"stable": true}\n', encoding="utf-8")

            def interrupted_dump(_payload, handle, **_kwargs):
                handle.write('{"partial":')
                handle.flush()
                raise OSError("simulated interrupted write")

            with patch("core.config._config_path", return_value=path), \
                    patch.object(json, "dump", side_effect=interrupted_dump):
                with self.assertRaisesRegex(OSError, "interrupted write"):
                    save_config({"stable": False})

            self.assertEqual(path.read_text(encoding="utf-8"), '{"stable": true}\n')

    def test_load_config_quarantines_invalid_json_and_recovers_defaults(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text('{"partial":', encoding="utf-8")

            with patch("core.config._config_path", return_value=path):
                loaded = load_config()

            self.assertEqual(loaded["api_port"], DEFAULT_CONFIG["api_port"])
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["api_port"], DEFAULT_CONFIG["api_port"])
            quarantined = list(Path(tmpdir).glob("config.json.corrupt-*"))
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(quarantined[0].read_text(encoding="utf-8"), '{"partial":')

    def test_load_config_quarantines_valid_json_with_non_object_root(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text('["not", "an", "object"]\n', encoding="utf-8")

            with patch("core.config._config_path", return_value=path):
                loaded = load_config()

            self.assertEqual(loaded["api_port"], DEFAULT_CONFIG["api_port"])
            quarantined = list(Path(tmpdir).glob("config.json.corrupt-*"))
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(quarantined[0].read_text(encoding="utf-8"), '["not", "an", "object"]\n')

    def test_first_load_returns_a_detached_default_config(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            with patch("core.config._config_path", return_value=path):
                loaded = load_config()

            loaded["ai"]["llm"]["api_key"] = "mutated"
            self.assertEqual(DEFAULT_CONFIG["ai"]["llm"]["api_key"], "")

    def test_partial_config_load_does_not_share_default_only_nested_branches(self):
        import tempfile
        from pathlib import Path

        snapshot = deepcopy(DEFAULT_CONFIG)
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                path.write_text('{"api_port": 19999}\n', encoding="utf-8")
                with patch("core.config._config_path", return_value=path):
                    loaded = load_config()

                loaded["ai"]["video"]["seedance_api_key"] = "mutated"
                loaded["notify"]["dingtalk_secret"] = "mutated"

            self.assertEqual(DEFAULT_CONFIG["ai"]["video"]["seedance_api_key"], "")
            self.assertEqual(DEFAULT_CONFIG["notify"]["dingtalk_secret"], "")
        finally:
            DEFAULT_CONFIG.clear()
            DEFAULT_CONFIG.update(snapshot)


if __name__ == "__main__":
    unittest.main()
