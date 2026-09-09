"""Build-only downloader. Installation consumes these hash-locked wheels offline."""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLATFORMS = {"mac-arm64": "macosx_11_0_arm64", "mac-x64": "macosx_10_15_x86_64", "win-x64": "win_amd64"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("targets", nargs="*", choices=list(PLATFORMS), default=list(PLATFORMS))
    args = parser.parse_args()
    for target in args.targets:
        lock = ROOT / "runtime-locks/python" / f"{target}-py312.txt"
        dest = ROOT / "build-staging/python-wheels" / target
        dest.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, "-m", "pip", "download", "--only-binary=:all:",
                        "--platform", PLATFORMS[target], "--python-version", "3.12", "--abi", "cp312",
                        "--implementation", "cp", "--require-hashes", "-r", str(lock), "-d", str(dest)], check=True)


if __name__ == "__main__":
    main()
