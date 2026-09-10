#!/usr/bin/env python3
"""Build local native helper or explicitly install Windows dependencies."""
import argparse
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--install-deps", action="store_true")
args = parser.parse_args()
if platform.system() == "Darwin":
    native = root / "scripts/native"
    with tempfile.TemporaryDirectory(prefix="crawshrimp-native-") as build:
        source = Path(build) / "main.swift"
        source.write_text((native / "mac_feedback.swift").read_text() + "\n" + (native / "mac.swift").read_text())
        subprocess.run(["swiftc", "-O", str(source), "-o", str(native / "mac")], check=True)
    print("Built macOS helper:", native / "mac")
elif platform.system() == "Windows":
    if args.install_deps:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(root / "requirements-windows.txt")], check=True)
    else:
        print("Install in your selected Python environment: python scripts/setup.py --install-deps")
else:
    parser.error("Desktop backends support macOS and Windows only")
