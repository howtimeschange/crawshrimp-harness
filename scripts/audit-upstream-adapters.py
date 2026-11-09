#!/usr/bin/env python3
"""Detect upstream adapter changes against the reviewed Harness migration lock."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "docs/crawshrimp-harness/upstream-adapters-lock.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def inventory(source):
    tracked = subprocess.check_output(["git", "ls-files", "adapters", "core", "scripts", "sdk"], cwd=source, text=True).splitlines()
    files = {name: digest(source / name) for name in tracked}
    packages = {}
    for path in sorted((source / "adapters").glob("*/manifest.yaml")):
        upstream = yaml.safe_load(path.read_text(encoding="utf-8"))
        target_path = ROOT / path.relative_to(source)
        target = yaml.safe_load(target_path.read_text(encoding="utf-8")) if target_path.exists() else {}
        packages[upstream["id"]] = {
            "name": target.get("name") or upstream["name"],
            "upstream_version": upstream["version"], "harness_version": target.get("version"),
            "upstream_tasks": len(upstream["tasks"]), "harness_tasks": len(target.get("tasks", [])),
        }
    return files, packages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT.parent / "crawshrimp")
    parser.add_argument("--record-reviewed", action="store_true", help="Record only after code review and validation")
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    files, packages = inventory(source)
    if args.record_reviewed:
        payload = {"schema_version": 1, "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip(),
                   "reviewed_date": "2026-11-09", "packages": packages,
                   "source_files": files, "harness_files": {name: digest(ROOT / name) for name in files},
                   "retained_differences": {
                       "cross-border-research": "Retain Harness 0.2.1 product-result counts and source links; do not regress to unverified SKC counts.",
                       "bala-ai-video-assistant": "Harness 0.1.2 forces copy-install upgrades for upstream same-version fixes.",
                       "tmall-ops-assistant": "Harness 0.1.6; preserve provider routing, atomic persistence, approval locking and partial results.",
                       "shenhui-new-arrival": "Harness 0.3.3; keep specialist entry, download model/runtime on demand; declare Harness compatibility.",
                   }}
        LOCK.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Recorded {len(packages)} adapters / {sum(name.startswith('adapters/') for name in files)} adapter files / {len(files)} total files")
        return
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    changed = sorted(name for name in files.keys() | lock["source_files"].keys() if files.get(name) != lock["source_files"].get(name))
    target_changed = sorted(name for name, expected in lock["harness_files"].items() if digest(ROOT / name) != expected)
    print(json.dumps({"adapters": len(packages), "files": len(files), "adapter_files": sum(name.startswith('adapters/') for name in files), "tasks": sum(item["upstream_tasks"] for item in packages.values()),
                      "upstream_changes": changed, "harness_changes_since_review": target_changed, "packages": packages}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if changed or target_changed else 0)


if __name__ == "__main__":
    main()
