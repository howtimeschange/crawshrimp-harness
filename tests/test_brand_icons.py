from pathlib import Path

from PIL import Image, ImageChops


ASSETS = Path(__file__).resolve().parents[1] / 'app' / 'assets'


def test_macos_icon_uses_c1_pixels_with_transparent_rounded_outer_corners():
    source = Image.open(ASSETS / 'branding/crawshrimp-logo-final-C1-short-antennae.png').convert('RGBA')
    artwork = source.resize((824, 824), Image.Resampling.LANCZOS)
    icon = Image.open(ASSETS / 'icon.icns').convert('RGBA')
    assert icon.size == (1024, 1024)
    assert icon.getpixel((101, 101))[3] == 0
    assert icon.getpixel((922, 101))[3] == 0
    assert icon.getpixel((512, 512)) == artwork.getpixel((412, 412))


def test_renderer_and_windows_icons_share_the_rounded_artwork_at_all_required_sizes():
    with Image.open(ASSETS / 'icon.png') as png, Image.open(ASSETS / 'icon.icns') as mac, Image.open(ASSETS / 'icon.ico') as ico:
        assert png.mode == 'RGBA'
        assert png.getchannel('A').getbbox() == (100, 100, 924, 924)
        assert ImageChops.difference(png, mac.convert('RGBA')).getbbox(alpha_only=False) is None
        sizes = {(n, n) for n in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)}
        assert ico.ico.sizes() == sizes
        for size in sizes:
            expected = png.resize(size, Image.Resampling.LANCZOS)
            assert ImageChops.difference(ico.ico.getimage(size), expected).getbbox(alpha_only=False) is None
