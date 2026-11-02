#!/usr/bin/env python3
"""Export the approved C1 logo, with a native rounded macOS silhouette.

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

    # UI and Windows keep the entire square composition, including its dark background.
    png = image.resize((1024, 1024), Image.Resampling.LANCZOS)
    png.save(ASSETS / "icon.png")
    png.save(ASSETS / "icon.ico", sizes=[(size, size) for size in ICO_SIZES])

    # Supply the macOS silhouette ourselves. An opaque square inside the
    # transparent margin is treated as a legacy icon and gains a light bezel.
    # Use the approved source pixels and clip only the rounded outer corners.
    art = image.resize((824, 824), Image.Resampling.LANCZOS)
    mask = Image.new("L", (824 * 4, 824 * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 824 * 4 - 1, 824 * 4 - 1), radius=184 * 4, fill=255)
    art.putalpha(mask.resize((824, 824), Image.Resampling.LANCZOS))
    mac = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    mac.alpha_composite(art, (100, 100))
    with tempfile.TemporaryDirectory(prefix="crawshrimp-C1-icons-") as temporary:
        iconset = Path(temporary) / "C1.iconset"
        iconset.mkdir()
        for points in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                pixels = points * scale
                suffix = "@2x" if scale == 2 else ""
                mac.resize((pixels, pixels), Image.Resampling.LANCZOS).save(
                    iconset / f"icon_{points}x{points}{suffix}.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset),
                        "-o", str(ASSETS / "icon.icns")], check=True)
    print("Exported icon.png, icon.icns, icon.ico from the approved C1 original")


if __name__ == "__main__":
    main()
