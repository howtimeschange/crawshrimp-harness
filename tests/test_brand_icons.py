from pathlib import Path

from PIL import Image


def test_macos_icon_uses_c1_pixels_with_transparent_rounded_outer_corners():
    assets = Path(__file__).resolve().parents[1] / 'app' / 'assets'
    source = Image.open(assets / 'branding/crawshrimp-logo-final-C1-short-antennae.png').convert('RGBA')
    artwork = source.resize((824, 824), Image.Resampling.LANCZOS)
    icon = Image.open(assets / 'icon.icns').convert('RGBA')
    assert icon.size == (1024, 1024)
    assert icon.getpixel((101, 101))[3] == 0
    assert icon.getpixel((922, 101))[3] == 0
    assert icon.getpixel((512, 512)) == artwork.getpixel((412, 412))
