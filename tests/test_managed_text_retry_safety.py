from unittest.mock import patch
from pathlib import Path

import pytest

from core import llm_gateway, shenhui_shoe_packaging as shoe
from core import shenhui_apparel_label_processing as apparel
from core.js_runner import _recognize_wash_care_media_sync


def unknown(*args, **kwargs):
    raise llm_gateway.LlmUnknownSubmissionError('请求编号：fixture')


def test_pose_unknown_never_retries_or_runs_fallback():
    calls = []
    def invoke(**kwargs):
        calls.append(kwargs['model_id'])
        unknown()
    with patch.object(shoe, '_shoe_pose_model_ids', return_value=['managed-a', 'fallback']), \
         patch.object(llm_gateway, 'generate_multimodal_json', side_effect=invoke):
        with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
            shoe._default_analyze_color(
                style_code='204426146036', color_code='60301', contact_sheet='all.jpg',
                contact_sheets=['all.jpg'], pose_strategy=shoe.SHOE_POSE_STRATEGY_SINGLE_SHEET,
                reference_image='ref.jpg', yq_reference_image='yq.jpg', candidate_ids={'I01':'one.jpg'},
                candidate_names=['one.jpg'], shoe_category='婴童', model_id='managed-a',
                fallback_model_ids=['fallback'], consensus_required_votes=1, config={})
    assert calls == ['managed-a']


def test_queued_pose_work_is_not_started_after_unknown():
    calls = []
    def invoke(model):
        calls.append(model)
        unknown()
    with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
        shoe._run_pose_model_wave(['one', 'two', 'three'], invoke, max_workers=1)
    assert calls == ['one']


def test_label_unknown_never_retries_or_runs_fallback():
    calls = []
    def invoke(**kwargs):
        calls.append(kwargs['model_id'])
        unknown()
    with patch.object(shoe, '_shoe_label_model_ids', return_value=['managed-a', 'fallback']), \
         patch.object(llm_gateway, 'generate_multimodal_json', side_effect=invoke):
        with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
            shoe._default_analyze_color_label(style_code='204426140034', color_code='00396',
                label_image='data:image/jpeg;base64,/9j/2Q==', model_id='managed-a',
                fallback_model_ids=['fallback'], config={})
    assert calls == ['managed-a']


def test_focused_label_unknown_preserves_exception_and_stops_fallback():
    calls = []
    def invoke(**kwargs):
        calls.append(kwargs['model_id'])
        if len(calls) > 1:
            unknown()
        return ({'style_code': '204426140034', 'product_name': '儿童休闲鞋',
                 'color_name': '黑红色调00396', 'color_code': '00396',
                 'label_bbox': [100,100,900,800], 'style_code_bbox': [180,520,520,580]},
                type('Route', (), {'model_id': kwargs['model_id']})())
    def local(payload, **kwargs):
        return {**payload, '_label_transcription': {'source':'local_tesseract_style_identity_ai_color_fallback'}}
    with patch.object(shoe, '_shoe_label_model_ids', return_value=['managed-a', 'fallback']), \
         patch.object(shoe, '_verify_label_payload_with_local_ocr', side_effect=local), \
         patch.object(llm_gateway, 'generate_multimodal_json', side_effect=invoke):
        with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
            shoe._default_analyze_color_label(style_code='204426140034', color_code='00396',
                label_image='data:image/jpeg;base64,/9j/2Q==', label_source_image='/nonexistent.jpg',
                model_id='managed-a', fallback_model_ids=['fallback'], config={})
    assert calls == ['managed-a', 'managed-a']


def test_apparel_unknown_aborts_remaining_reviews():
    jobs = [apparel.ReviewJob('one', Path('one.jpg'), 'style'), apparel.ReviewJob('two', Path('two.jpg'), 'style')]
    calls = []
    def reviewer(job, model):
        calls.append((job.job_id, model))
        unknown()
    with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
        apparel.review_inputs_concurrently(jobs, model_ids=['managed-a', 'fallback'], reviewer=reviewer, max_workers=1)
    assert calls == [('one', 'managed-a')]


def test_wash_care_does_not_hide_unknown_with_local_text(tmp_path):
    image = tmp_path / 'label.jpg'; image.write_bytes(b'fixture')
    text = tmp_path / 'label.txt'; text.write_text('手洗，不可漂白，不可熨烫', encoding='utf-8')
    with patch.object(llm_gateway, 'generate_multimodal_json', side_effect=unknown):
        with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
            _recognize_wash_care_media_sync(items=[{'path': str(image)}, {'path': str(text)}], artifact_dir=tmp_path)
