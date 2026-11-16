# Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE.
"""Crop the user-supplied QQ group card locally without changing QR pixels.

Usage: python scripts/crop-community-qr.py <original-card.jpg>
The original stays outside the repository; only its presentation crop is bundled.
Requires Pillow for this maintainer command, not for the application.
"""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).resolve()
target = ROOT / "ui" / "assets" / "community" / "qq-group.png"
bounds = (200, 856, 1341, 1997)
with Image.open(source) as original:
    assert original.size == (1541, 2740), "Unexpected source dimensions; inspect before cropping"
    crop = original.convert("RGB").crop(bounds)
    target.parent.mkdir(parents=True, exist_ok=True)
    crop.save(target, optimize=True)
    with Image.open(target) as saved:
        assert saved.size == (1141, 1141)
        assert saved.tobytes() == crop.tobytes(), "QR pixels changed"
print(json.dumps({
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "cropSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    "bounds": bounds, "dimensions": crop.size,
    "originalPixelsPreserved": True, "sourceUnmodified": True,
}, indent=2))
