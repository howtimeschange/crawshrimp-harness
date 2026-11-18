#!/usr/bin/env python3
"""Export the approved C1 logo with the rounded app icon silhouette.

Run from the repository root with venv/bin/python3 app/scripts/export-brand-icons.py.
Pillow and macOS iconutil are required. This does not build or publish the app.
"""
from pathlib import Path
import hashlib
import subprocess
import tempfile

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parents[1] / "assets"
SOURCE = ASSETS / "branding/crawshrimp-logo-final-C1-short-antennae.png"
SOURCE_SHA256 = "ae09393d9aa47cf11c32cf4052875f3fdd7cdeb93c98e24799eae39fb7749352"
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)


def main():
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("The source must be the user-approved C1 short-antennae original")
    with Image.open(SOURCE) as original:
        if original.size != (1254, 1254):
            raise ValueError("Unexpected original dimensions")
        image = original.convert("RGBA")

    # Use the approved artwork with transparent safety space and rounded corners.
    art = image.resize((824, 824), Image.Resampling.LANCZOS)
    mask = Image.new("L", (824 * 4, 824 * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 824 * 4 - 1, 824 * 4 - 1), radius=184 * 4, fill=255)
    art.putalpha(mask.resize((824, 824), Image.Resampling.LANCZOS))
    icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    icon.alpha_composite(art, (100, 100))
    icon.save(ASSETS / "icon.png")
    icon.save(ASSETS / "icon.ico", sizes=[(size, size) for size in ICO_SIZES])

    with tempfile.TemporaryDirectory(prefix="crawshrimp-C1-icons-") as temporary:
        iconset = Path(temporary) / "C1.iconset"
        iconset.mkdir()
        for points in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                pixels = points * scale
                suffix = "@2x" if scale == 2 else ""
                icon.resize((pixels, pixels), Image.Resampling.LANCZOS).save(
                    iconset / f"icon_{points}x{points}{suffix}.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset),
                        "-o", str(ASSETS / "icon.icns")], check=True)
    print("Exported icon.png, icon.icns, icon.ico from the approved C1 original")


if __name__ == "__main__":
    main()
