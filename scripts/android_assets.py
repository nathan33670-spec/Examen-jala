#!/usr/bin/env python3
"""Icônes de lancement et écrans de démarrage Android à partir des icônes de l'application.

    python scripts/android_assets.py     # écrit dans android/app/src/main/res/
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
ICONS = ROOT / "docs" / "icons"
BRAND = (15, 76, 92)  # #0f4c5c, couleur de l'application
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def round_mask(img: Image.Image) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def main() -> int:
    maskable = Image.open(ICONS / "icon-maskable-512.png").convert("RGBA")
    plain = Image.open(ICONS / "icon-512.png").convert("RGBA")
    for name, k in DENSITIES.items():
        d = RES / f"mipmap-{name}"
        d.mkdir(parents=True, exist_ok=True)
        size, fg = round(48 * k), round(108 * k)
        maskable.resize((size, size), Image.LANCZOS).save(d / "ic_launcher.png")
        round_mask(maskable.resize((size, size), Image.LANCZOS)).save(d / "ic_launcher_round.png")
        # icône adaptative : le motif occupe la zone sûre (66 % du calque de premier plan)
        layer = Image.new("RGBA", (fg, fg), (0, 0, 0, 0))
        inner = round(fg * 0.66)
        motif = maskable.resize((inner, inner), Image.LANCZOS)
        layer.paste(motif, ((fg - inner) // 2, (fg - inner) // 2), motif)
        layer.save(d / "ic_launcher_foreground.png")
    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F4C5C</color>\n</resources>\n',
        encoding="utf-8")
    for splash in RES.glob("drawable*/splash.png"):
        w, h = Image.open(splash).size
        canvas = Image.new("RGB", (w, h), BRAND)
        side = round(min(w, h) * 0.35)
        logo = plain.resize((side, side), Image.LANCZOS)
        canvas.paste(logo, ((w - side) // 2, (h - side) // 2), logo)
        canvas.save(splash)
    print("icônes et écrans de démarrage Android générés")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
