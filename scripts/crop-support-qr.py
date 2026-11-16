# Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE.
"""Derive presentation-only crops without redrawing the official QR pixels.

Requires Pillow for this offline maintainer command, not for the application.
The public original files under docs/images are deliberately left untouched.
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CROPS = {
    "alipay": ((246, 708, 1013, 1475), 80),
    "wechat": ((367, 450, 912, 995), 56),
}

for name, (bounds, quiet_zone) in CROPS.items():
    with Image.open(ROOT / "docs" / "images" / f"donate-{name}.jpg") as source:
        code = source.convert("RGB").crop(bounds)
        presentation = ImageOps.expand(code, border=quiet_zone, fill="white")
        target = ROOT / "ui" / "assets" / "support" / f"qr-{name}.png"
        presentation.save(target, optimize=True)
        # This check catches accidental resizing, filtering or regenerated modules.
        with Image.open(target) as saved:
            restored = saved.crop((quiet_zone, quiet_zone,
                                   quiet_zone + code.width, quiet_zone + code.height))
            assert restored.tobytes() == code.tobytes()
        print(f"{target.name}: {presentation.width}x{presentation.height}; original QR pixels unchanged")
