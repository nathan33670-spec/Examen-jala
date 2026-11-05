#!/usr/bin/env python3
"""Visuels de la fiche Play Store : icône 512 × 512 et bannière 1024 × 500 (dossier store/).

    python scripts/store_assets.py

Les captures d'écran (store/captures/, 1080 × 1920) sont prises dans l'application elle-même.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store"
FONTS = Path("/usr/share/fonts/truetype")
PRIMARY = (29, 79, 145)      # #1d4f91, couleur de l'application


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("liberation/LiberationSans-Bold.ttf" if bold else "liberation/LiberationSans-Regular.ttf"),
                 ("dejavu/DejaVuSans-Bold.ttf" if bold else "dejavu/DejaVuSans.ttf")):
        if (FONTS / name).exists():
            return ImageFont.truetype(str(FONTS / name), size)
    return ImageFont.load_default()


def main() -> int:
    OUT.mkdir(exist_ok=True)
    icon = Image.open(ROOT / "docs" / "icons" / "icon-512.png").convert("RGBA")
    icon.resize((512, 512), Image.LANCZOS).save(OUT / "icone-512.png")

    w, h = 1024, 500
    banner = Image.new("RGB", (w, h), PRIMARY)
    draw = ImageDraw.Draw(banner)
    logo = icon.resize((220, 220), Image.LANCZOS)
    banner.paste(logo, (72, (h - 220) // 2), logo)
    x = 340
    draw.text((x, 150), "Prépa JA Badminton", font=font(58, True), fill="white")
    draw.text((x, 232), "Juge-arbitre JALA et arbitre ALA", font=font(32), fill=(222, 232, 246))
    draw.text((x, 284), "Plus de 2 300 questions corrigées", font=font(28), fill=(222, 232, 246))
    draw.text((x, 326), "Règlements fédéraux et de ligue, hors ligne", font=font(28), fill=(222, 232, 246))
    banner.save(OUT / "banniere-1024x500.png", optimize=True)
    print("store/icone-512.png et store/banniere-1024x500.png générés")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
