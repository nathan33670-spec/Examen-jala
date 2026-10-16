#!/usr/bin/env python3
"""Affiche le texte extrait d'un document du catalogue (pour rédiger ou vérifier des questions).

    python scripts/doc_text.py 03.01            # texte structuré (titres préfixés par #)
    python scripts/doc_text.py REGLES --pdf     # texte brut du PDF (mise en page conservée, tableaux)
    python scripts/doc_text.py --list           # liste des documents disponibles
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "docs"


def main(argv: list[str]) -> int:
    catalog = json.loads((SITE / "data" / "catalog.json").read_text(encoding="utf-8"))
    docs = {d["id"]: d for d in catalog["docs"]}
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--list":
        for d in catalog["docs"]:
            print(f"{d['id']:22} {d.get('pages') or '?':>3} p.  {d['title']}")
        return 0
    doc = docs.get(argv[0])
    if not doc:
        print(f"Document inconnu : {argv[0]} (voir --list)", file=sys.stderr)
        return 1
    if "--pdf" in argv:
        pdf = SITE / doc["pdf"]
        return subprocess.call(["pdftotext", "-layout", str(pdf), "-"])
    data = json.loads((SITE / doc["text"]).read_text(encoding="utf-8"))
    print(f"# {doc['id']} — {doc['title']} (saison {doc.get('season')})")
    for kind, text in data.get("blocks", []):
        if kind in ("h2", "h3", "h4"):
            print(f"\n{'#' * int(kind[1])} {text}")
        elif kind == "li":
            print(f"  – {text}")
        else:
            print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
