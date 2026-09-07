from pathlib import Path

from core.agent import mcp_gateway


ROOT = Path(__file__).resolve().parents[1]
HARNESS_ROOT = ROOT / "integrations" / "deepseek-harness"
SKILLS_ROOT = HARNESS_ROOT / "skills"

BUILTIN_GENERAL_SKILLS = {
    "bilibili-video-transcript": [
        "SKILL.md",
        "README.md",
        "requirements.txt",
        "references/bilibili_api.md",
        "scripts/bilibili_video_capture.py",
    ],
    "xhs-video-capture": [
        "SKILL.md",
        "README.md",
        "scripts/xhs_video_capture.py",
    ],
    "banner-generation": [
        "SKILL.md",
        "README.md",
        "references/1xm-configuration.md",
        "scripts/generate_1xm_image.mjs",
        "scripts/render_html_banner.mjs",
    ],
    "suanming": [
        "SKILL.md",
        "README.md",
        "references/classical-texts.md",
        "tools/bazi_pan.py",
        "tools/bazi/calendar.py",
    ],
    "ecommerce-img-gen": [
        "SKILL.md",
        "README.md",
        "references/platform_specs.md",
        "references/styles_and_routing.md",
        "scripts/generate_image.py",
    ],
}


def _with_active_run():
    previous = mcp_gateway.ctx.active_run
    mcp_gateway.ctx.active_run = {"run_id": "run", "session_id": "session"}
    return previous


def test_general_builtin_skills_are_listed_and_readable(monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_SKILL_ROOT", str(SKILLS_ROOT))
    previous = _with_active_run()
    try:
        result = mcp_gateway.tool_skill_list()
        read_result = mcp_gateway.tool_skill_read("ecommerce-img-gen/SKILL.md")
    finally:
        mcp_gateway.ctx.active_run = previous

    assert result["ok"] is True
    data = result["data"]
    assert data["root"] == str(SKILLS_ROOT)
    assert set(BUILTIN_GENERAL_SKILLS).issubset(set(data["packs"]))
    assert read_result["ok"] is True
    assert read_result["data"]["absolute_path"] == str(SKILLS_ROOT / "ecommerce-img-gen" / "SKILL.md")
    assert "ecommerce-img-gen" in read_result["data"]["content"]


def test_general_builtin_skill_packages_have_required_files():
    for skill, files in BUILTIN_GENERAL_SKILLS.items():
        skill_root = SKILLS_ROOT / skill
        for rel in files:
            assert (skill_root / rel).is_file(), f"{skill}/{rel} missing"
        frontmatter = (skill_root / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[1]
        assert f"name: {skill}" in frontmatter


def test_general_builtin_skills_avoid_external_install_paths():
    checked = [
        SKILLS_ROOT / "bilibili-video-transcript" / "README.md",
        SKILLS_ROOT / "banner-generation" / "SKILL.md",
        SKILLS_ROOT / "banner-generation" / "README.md",
        SKILLS_ROOT / "banner-generation" / "scripts" / "render_html_banner.mjs",
        SKILLS_ROOT / "ecommerce-img-gen" / "SKILL.md",
        SKILLS_ROOT / "ecommerce-img-gen" / "README.md",
        SKILLS_ROOT / "ecommerce-img-gen" / "scripts" / "generate_image.py",
        SKILLS_ROOT / "suanming" / "README.md",
        SKILLS_ROOT / "suanming" / "OPENCLAW.md",
    ]
    forbidden = ("~/.codex/skills", "~/.openclaw", "/Users/xingyicheng")
    for path in checked:
        text = path.read_text(encoding="utf-8")
        for needle in forbidden:
            assert needle not in text, f"{path} still references {needle}"


def test_general_builtin_skills_are_part_of_staging_contract():
    stage = (HARNESS_ROOT / "scripts" / "stage-runtime.mjs").read_text(encoding="utf-8")
    assert "hashTree(join(sourceRoot, 'skills'))" in stage
    assert "'worker', 'skills', 'crawshrimp-launcher'" in stage
    assert "cpSync(source, join(stageRoot, name)" in stage

    # rc.1 Web profiles deliberately avoid a flat web-cordis.yml tool list.
    # Crawshrimp selects its product-owned copy of the complete standard
    # preset so the effective persona is preserved without dropping skills.
    worker = (HARNESS_ROOT / "worker" / "worker.mjs").read_text(encoding="utf-8")
    crawshrimp_preset = (
        HARNESS_ROOT / "profile" / "web" / "agent-presets"
        / "crawshrimp-standard" / "agent.cordis.yml"
    ).read_text(encoding="utf-8")
    assert "agentPreset: 'crawshrimp-standard'" in worker
    assert "name: '@deepseek-ai/dsh-skill-filesystem'" in crawshrimp_preset
    assert "name: '@deepseek-ai/dsh-tool-skill'" in crawshrimp_preset
