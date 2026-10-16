#!/usr/bin/env python3
"""Contrôle d'un ou plusieurs fichiers de questions avant compilation.

    python scripts/check_questions.py content/questions/20-exemple.txt [...]

Vérifie le format (via le parseur de build_site), les identifiants (uniques dans toute la
banque), les thèmes, niveaux et références, signale les articles introuvables dans le texte
du document cité et les questions trop proches d'une question existante. Ne modifie rien.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_site  # noqa: E402

POSITIONAL = re.compile(r"(ci-dessus|ci-dessous|aucune des réponses|toutes les réponses|les deux premières)", re.I)
STOP = set("le la les un une des du de d l à au aux en et ou est sont il elle on qui que quoi quel quelle quels "
           "quelles pour par sur dans ce cette ces se sa son ses ne pas peut doit doivent lors".split())


def norm_words(text: str) -> set[str]:
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return {w for w in re.findall(r"[a-z0-9]+", t) if w not in STOP and len(w) > 1}


def article_index(catalog: dict) -> dict[str, str]:
    """doc id -> texte brut (pour vérifier que l'article cité existe)."""
    out = {}
    for d in catalog.get("docs", []):
        p = ROOT / "docs" / (d.get("text") or "")
        if d.get("text") and p.exists():
            blocks = json.loads(p.read_text(encoding="utf-8")).get("blocks", [])
            out[d["id"]] = "\n".join(b[1] for b in blocks)
    return out


def article_found(text: str, art: str) -> bool:
    art = art.strip()
    if not art:
        return True
    first = re.split(r"[\s,;/]+", art.replace("Instr.", "").replace("§", "").strip())[0].rstrip(".")
    if not first:
        return True
    if not re.match(r"^[0-9]", first):
        return first.lower() in text.lower()
    return re.search(rf"(^|\n|\s){re.escape(first)}\.?(\s|$)", text) is not None


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    targets = [Path(a).resolve() for a in argv]
    catalog = json.loads((ROOT / "docs" / "data" / "catalog.json").read_text(encoding="utf-8"))
    texts = article_index(catalog)
    errors: list[str] = []
    warnings: list[str] = []

    all_files = sorted((ROOT / "content" / "questions").glob("*.txt"))
    for t in targets:
        if t not in all_files:
            all_files.append(t)
    bank: list[dict] = []
    mine: list[dict] = []
    for f in all_files:
        try:
            qs = build_site.parse_questions(f)
        except build_site.ContentError as err:
            errors.append(str(err))
            continue
        for q in qs:
            q["_file"] = f.name
        bank.extend(qs)
        if f in targets:
            mine.extend(qs)

    errors += [e for e in build_site.validate(bank, [], catalog) if any(q["id"] in e for q in mine)]

    others = [q for q in bank if q not in mine]
    other_words = [(q, norm_words(q["q"] + " " + " ".join(q["choices"][i] for i in q["answer"]))) for q in others]
    seen_mine: list[tuple[dict, set[str]]] = []
    for q in mine:
        qid = q["id"]
        if not 3 <= len(q["choices"]) <= 5:
            errors.append(f"{qid} : {len(q['choices'])} propositions (3 à 5 attendues)")
        if len(q["answer"]) >= len(q["choices"]):
            errors.append(f"{qid} : toutes les propositions sont justes")
        for c in q["choices"]:
            if POSITIONAL.search(c):
                errors.append(f"{qid} : proposition dépendant de l'ordre d'affichage : « {c} »")
        if len(q["explain"]) < 25:
            warnings.append(f"{qid} : explication très courte")
        ref = q.get("ref") or {}
        txt = texts.get(ref.get("doc", ""))
        if txt is not None and not article_found(txt, ref.get("art", "")):
            warnings.append(f"{qid} : article « {ref.get('art')} » introuvable dans le texte de {ref.get('doc')}")
        words = norm_words(q["q"] + " " + " ".join(q["choices"][i] for i in q["answer"]))
        for pool, label in ((other_words, "banque"), (seen_mine, "même lot")):
            for other, ow in pool:
                if other is q or not words or not ow:
                    continue
                sim = len(words & ow) / len(words | ow)
                if sim >= 0.7:
                    warnings.append(f"{qid} : très proche de {other['id']} ({label}, similarité {sim:.2f})")
                    break
        seen_mine.append((q, words))

    by_type = {"single": 0, "multiple": 0}
    for q in mine:
        by_type[q["type"]] += 1
    for e in errors:
        print("ERREUR :", e)
    for w in warnings:
        print("attention :", w)
    print(f"{len(mine)} question(s) contrôlée(s) ({by_type['single']} à réponse unique, {by_type['multiple']} à réponses multiples) ; "
          f"{len(errors)} erreur(s), {len(warnings)} avertissement(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
