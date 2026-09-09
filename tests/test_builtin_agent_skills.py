from pathlib import Path
import shutil

from core.agent import mcp_gateway


ROOT = Path(__file__).resolve().parents[1]
HARNESS_ROOT = ROOT / "integrations" / "deepseek-harness"
SKILLS_ROOT = HARNESS_ROOT / "skills"

BUILTIN_GENERAL_SKILLS = {
    "office-design-taste": [
        "SKILL.md",
        "LICENSE",
        "UPSTREAM.md",
        "references/ppt-layout.md",
        "references/word-layout.md",
    ],
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

EXPECTED_TOP_LEVEL_SKILL_PACKS = {
    *BUILTIN_GENERAL_SKILLS,
    "cli-bmall",
    "cli-deepdraw",
    "cli-semir-yunpan",
    "cli-tmall",
    "cli-vipshop-hot-strategy",
    "crawshrimp-adapter-skill",
    "crawshrimp-probe-skill",
    "crawshrimp-skill",
    "dont-stop",
    "web-automation-skill",
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


def test_office_design_skill_remains_readable_after_install_relocation(monkeypatch, tmp_path):
    """The model must find the design pack and read each guide from an installed root."""
    installed = tmp_path / "应用 Resources" / "deepseek-harness" / "skills"
    pack = "office-design-taste"
    shutil.copytree(SKILLS_ROOT / pack, installed / pack)
    monkeypatch.setenv("CRAWSHRIMP_SKILL_ROOT", str(installed))
    monkeypatch.setenv("CRAWSHRIMP_GENERATED_SKILL_ROOT", str(tmp_path / "generated"))
    previous = _with_active_run()
    try:
        listed = mcp_gateway.tool_skill_list()
        assert pack in listed["data"]["packs"]
        for rel in BUILTIN_GENERAL_SKILLS[pack]:
            if not rel.endswith(".md"):
                continue
            result = mcp_gateway.tool_skill_read(f"{pack}/{rel}")
            assert result["ok"] is True
            assert result["data"]["truncated"] is False
            assert result["data"]["content"] == (installed / pack / rel).read_text(encoding="utf-8")
            assert result["data"]["absolute_path"] == str(installed / pack / rel)
    finally:
        mcp_gateway.ctx.active_run = previous


def test_every_staged_top_level_skill_is_discoverable_and_has_frontmatter(monkeypatch):
    """Do not regress to a few vendored packs while leaving product skills unreadable."""
    monkeypatch.setenv("CRAWSHRIMP_SKILL_ROOT", str(SKILLS_ROOT))
    previous = _with_active_run()
    try:
        listed = mcp_gateway.tool_skill_list()
        skill_files = sorted(SKILLS_ROOT.glob("*/SKILL.md"))
        names = {path.parent.name for path in skill_files}
        reads = [mcp_gateway.tool_skill_read(path.relative_to(SKILLS_ROOT).as_posix()) for path in skill_files]
    finally:
        mcp_gateway.ctx.active_run = previous

    assert EXPECTED_TOP_LEVEL_SKILL_PACKS.issubset(names)
    assert EXPECTED_TOP_LEVEL_SKILL_PACKS.issubset(set(listed["data"]["packs"]))
    assert all(item["ok"] for item in reads)
    for path, item in zip(skill_files, reads, strict=True):
        content = item["data"]["content"]
        assert content.startswith("---\n")
        frontmatter = content.split("---", 2)[1]
        assert "name:" in frontmatter
        assert item["data"]["absolute_path"] == str(path)
        assert item["data"]["root"] == str(SKILLS_ROOT)


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
    assert "copyDir(source, join(stageRoot, name)" in stage

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


def test_cli_skill_runtime_is_built_during_staging_and_never_delegated_to_users():
    stage = (HARNESS_ROOT / "scripts" / "stage-runtime.mjs").read_text(encoding="utf-8")
    main = (ROOT / "app" / "src" / "main.js").read_text(encoding="utf-8")
    app_package = (ROOT / "app" / "package.json").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-desktop.yml").read_text(encoding="utf-8")

    assert "buildCliSkillRuntimes(cliDest)" in stage
    assert "hashTree(cliSource)" in stage
    assert "EXCLUDED_SOURCE_TREE_ENTRIES.has(name)" in stage
    assert "git submodule update --init --recursive" in stage
    for package in ("bmall-cli", "DeepDrawCLI", "semir-yunpan-cli", "tmall-cli"):
        assert package in stage
    assert "CRAWSHRIMP_PYTHON_EXECUTABLE: pythonBin" in main
    # Development stages the same closure that production embeds, rather than
    # exposing skill documentation whose executable cannot be resolved.
    assert "CRAWSHRIMP_CLI_ROOT: cliSkillRoot" in main
    assert "stage-runtime.mjs --skip-boot-check" in app_package
    assert workflow.count("submodules: recursive") >= 2

    node_docs = [
        SKILLS_ROOT / "cli-bmall" / "SKILL.md",
        SKILLS_ROOT / "cli-deepdraw" / "SKILL.md",
        SKILLS_ROOT / "cli-semir-yunpan" / "SKILL.md",
        SKILLS_ROOT / "cli-tmall" / "SKILL.md",
    ]
    for path in node_docs:
        text = path.read_text(encoding="utf-8")
        assert "CRAWSHRIMP_NODE_EXECUTABLE" in text
        assert "## 内置运行时" in text
        assert "首次使用" not in text
    vipshop = (SKILLS_ROOT / "cli-vipshop-hot-strategy" / "SKILL.md").read_text(encoding="utf-8")
    assert "CRAWSHRIMP_PYTHON_EXECUTABLE" in vipshop
    assert "## 内置运行时" in vipshop
    assert "首次使用" not in vipshop


def test_web_skills_distinguish_installed_product_tools_from_repo_only_helpers():
    web = (SKILLS_ROOT / "web-automation-skill" / "SKILL.md").read_text(encoding="utf-8")
    probe = (SKILLS_ROOT / "crawshrimp-probe-skill" / "SKILL.md").read_text(encoding="utf-8")
    for text in (web, probe):
        assert "untrusted reference data" in text
    assert "## Product Runtime Entry" in web
    assert "## Repository Development Entry" in web
    assert "browser_observe" in web
    assert "## Installed Product Action" in probe
    assert "## Repository Development Action" in probe
