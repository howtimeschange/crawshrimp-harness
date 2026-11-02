#!/usr/bin/env python3
"""Export the approved transparent C1 bust and its offline DSH representation."""
from pathlib import Path
import base64
import hashlib
import io
import json
import re

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "app/assets/branding"
SOURCE_SHA256 = "d4e6c47c3e8a63c4e56af3eb83ce78d3c247685669c432e91f8f4a81b2dde57c"


def main():
    source = ASSETS / "crawshrimp-avatar-C1-source.png"
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Expected the approved C1 transparent half-body original")
    image = Image.open(source).convert("RGBA")
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(image.resize((240, 240), Image.Resampling.LANCZOS), (8, 8))
    canvas.save(ASSETS / "crawshrimp-avatar-C1.png")

    buffer = io.BytesIO()
    canvas.resize((128, 128), Image.Resampling.LANCZOS).save(buffer, format="PNG", optimize=True)
    data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    client = ROOT / "integrations/deepseek-harness/crawshrimp-slots/lib/client.js"
    text, count = re.subn(
        r'(const CRAWSHRIMP_BRAND_MARK_URL = )"data:image/png;base64,[A-Za-z0-9+/=]+"',
        lambda match: match.group(1) + json.dumps(data_url), client.read_text(),
    )
    if count != 1:
        raise ValueError("Expected exactly one offline DSH brand asset anchor")
    client.write_text(text)
    print(f"Exported 256px avatar and one {len(buffer.getvalue())}-byte offline DSH image")


if __name__ == "__main__":
    main()
