#!/usr/bin/env python3
"""Construit les données de l'application à partir de content/ et prépare le cache hors-ligne.

1. compile content/questions/*.txt  -> docs/data/questions.json
2. compile content/cases/*.txt      -> docs/data/cases.json
3. vérifie la cohérence (identifiants uniques, réponses, références aux documents)
4. écrit docs/data/precache.json (liste des fichiers mis en cache pour le mode hors-ligne)
5. met à jour l'identifiant de build dans docs/sw.js (force la mise à jour du cache)

Usage : python scripts/build_site.py [--site docs] [--check]
   --check : échoue si les fichiers générés ne sont pas à jour (utilisé par la CI).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEVELS = ("JALA", "JALC", "JAFA", "JAFC")
CORE_EXT = {".html", ".css", ".js", ".json", ".webmanifest", ".png", ".svg", ".ico", ".woff2"}
EXCLUDE_CORE = {"sw.js", "data/precache.json", "404.html"}
# redirection de l'ancienne adresse …/docs/ : jamais mise en cache
EXCLUDE_PREFIX = ("docs/",)

THEMES = {
    "regles": "Règles du jeu",
    "instructions": "Instructions aux officiels techniques",
    "rgc": "Règlement général des compétitions",
    "annexes": "Annexes du RGC (formats, durées, jeunes…)",
    "sanctions": "Cartons, forfaits et sanctions",
    "conduite": "Codes de conduite et éthique",
    "tenues": "Tenues vestimentaires et publicité",
    "tournois": "Autorisation et homologation des tournois",
    "filiere": "Filière juge-arbitrage",
    "joueurs": "Catégories d'âge, licences et classement",
    "interclubs": "Interclubs (ICN / ICR)",
    "sante": "Santé, sécurité et antidopage",
    "logiciel": "Logiciel de compétition (BadNet) : cas sur écran",
    "arbitrage": "Module ALA : arbitre et juge de service (hors programme JA)",
    "jdl": "Module juge de ligne (hors programme JA)",
}


class ContentError(Exception):
    pass


# --------------------------------------------------------------------------- questions

def parse_header(line: str, defaults: dict) -> dict:
    parts = [p.strip() for p in line[1:].split("|")]
    head = parts[0].split()
    if not head:
        raise ContentError(f"identifiant manquant : {line!r}")
    q = {"id": head[0], "theme": defaults.get("theme"), "levels": list(defaults.get("levels", LEVELS)),
         "difficulty": int(defaults.get("difficulty", 1))}
    ref = defaults.get("doc")
    for p in parts[1:]:
        if ":" not in p:
            raise ContentError(f"attribut invalide « {p} » dans {line!r}")
        key, val = (x.strip() for x in p.split(":", 1))
        key = key.upper()
        if key == "L":
            q["levels"] = val.split()
        elif key == "D":
            q["difficulty"] = int(val)
        elif key == "R":
            ref = val
        elif key == "T":
            q["theme"] = val
        else:
            raise ContentError(f"clé inconnue {key} dans {line!r}")
    if ref:
        doc, _, art = ref.partition(" ")
        q["ref"] = {"doc": doc, "art": art.strip()}
    return q


def parse_questions(path: Path) -> list[dict]:
    defaults: dict = {}
    out: list[dict] = []
    cur: dict | None = None
    text_lines: list[str] = []

    def finish():
        nonlocal cur, text_lines
        if cur is None:
            return
        cur["q"] = " ".join(text_lines).strip()
        if not cur["q"]:
            raise ContentError(f"{path.name}:{cur['id']} : énoncé vide")
        if len(cur["choices"]) < 2:
            raise ContentError(f"{path.name}:{cur['id']} : au moins 2 propositions requises")
        if not cur["answer"]:
            raise ContentError(f"{path.name}:{cur['id']} : aucune bonne réponse (+)")
        cur["type"] = "multiple" if len(cur["answer"]) > 1 else "single"
        cur["explain"] = " ".join(cur.get("explain_lines", [])).strip()
        cur.pop("explain_lines", None)
        if not cur["explain"]:
            raise ContentError(f"{path.name}:{cur['id']} : explication manquante (>)")
        out.append(cur)
        cur, text_lines = None, []

    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("@"):
            key, _, val = line[1:].partition(" ")
            val = val.strip()
            if key == "levels":
                defaults["levels"] = val.split()
            elif key in ("theme", "doc", "difficulty"):
                defaults[key] = val
            else:
                raise ContentError(f"{path.name}:{n} directive inconnue @{key}")
            continue
        if line.startswith("Q "):
            finish()
            cur = parse_header(line, defaults)
            cur.update({"choices": [], "answer": [], "explain_lines": []})
            continue
        if cur is None:
            raise ContentError(f"{path.name}:{n} texte hors question : {line!r}")
        if re.fullmatch(r"L:\s*((JALA|JALC|JAFA|JAFC)\s*)+", line.strip()):
            cur["levels"] = line.strip()[2:].split()  # niveaux indiqués sur une ligne à part
            continue
        m_img = re.fullmatch(r"IMG:\s*(\S+)(?:\s+(.+))?", line.strip())
        if m_img:  # illustration (écran de logiciel, feuille de match…) dans docs/img/
            if not (ROOT / "docs" / "img" / m_img.group(1)).exists():
                raise ContentError(f"{path.name}:{n} image introuvable : docs/img/{m_img.group(1)}")
            cur["img"] = {"src": f"img/{m_img.group(1)}", "alt": (m_img.group(2) or "").strip()}
            continue
        if re.match(r"^[DRT]:\s", line.strip()):
            raise ContentError(f"{path.name}:{n} attribut « {line.strip()[:2]} » à placer dans l'en-tête Q")
        if line.startswith(("- ", "+ ")):
            if cur["explain_lines"]:
                raise ContentError(f"{path.name}:{n} proposition après l'explication")
            if line[0] == "+":
                cur["answer"].append(len(cur["choices"]))
            cur["choices"].append(line[2:].strip())
        elif line.startswith(">"):
            cur["explain_lines"].append(line[1:].strip())
        elif cur["choices"]:
            if cur["explain_lines"]:
                cur["explain_lines"].append(line.strip())
            else:  # proposition sur plusieurs lignes
                cur["choices"][-1] += " " + line.strip()
        else:
            text_lines.append(line.strip())
    finish()
    return out


# --------------------------------------------------------------------------- cas pratiques

def parse_cases(path: Path) -> list[dict]:
    """Format :
    === id | L: JALA JALC | T: thème | titre
    CONTEXTE
    texte…
    ÉTAPE
    question…
    - choix
    + bon choix
    > explication
    DÉBRIEF
    texte…
    RÉF: 03.01 2.18 ; REGLES Instr. 3.6
    """
    cases: list[dict] = []
    cur: dict | None = None
    section: str | None = None
    step: dict | None = None

    def flush_step():
        nonlocal step
        if cur is not None and step is not None:
            if not step["choices"] or not step["answer"]:
                raise ContentError(f"{path.name}:{cur['id']} : étape sans choix ou sans bonne réponse")
            step["q"] = step["q"].strip()
            step["explain"] = step["explain"].strip()
            step["type"] = "multiple" if len(step["answer"]) > 1 else "single"
            cur["steps"].append(step)
        step = None

    def finish():
        nonlocal cur
        flush_step()
        if cur is None:
            return
        for key in ("context", "debrief"):
            cur[key] = cur[key].strip()
        if not cur["steps"]:
            raise ContentError(f"{path.name}:{cur['id']} : aucun ÉTAPE")
        cases.append(cur)
        cur = None

    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.rstrip()
        if line.lstrip().startswith("#") and not line.startswith("##"):
            continue
        if line.startswith("==="):
            finish()
            parts = [p.strip() for p in line[3:].split("|")]
            cur = {"id": parts[0], "levels": list(LEVELS), "theme": "", "title": parts[-1],
                   "context": "", "steps": [], "debrief": "", "refs": []}
            for p in parts[1:-1]:
                key, _, val = p.partition(":")
                if key.strip().upper() == "L":
                    cur["levels"] = val.split()
                elif key.strip().upper() == "T":
                    cur["theme"] = val.strip()
            section = None
            continue
        if cur is None:
            if line.strip():
                raise ContentError(f"{path.name}:{n} texte hors cas : {line!r}")
            continue
        token = line.strip().upper()
        if token in ("CONTEXTE", "ÉTAPE", "ETAPE", "DÉBRIEF", "DEBRIEF"):
            flush_step()
            section = {"CONTEXTE": "context", "ÉTAPE": "step", "ETAPE": "step",
                       "DÉBRIEF": "debrief", "DEBRIEF": "debrief"}[token]
            if section == "step":
                step = {"q": "", "choices": [], "answer": [], "explain": ""}
            continue
        if line.startswith(("RÉF:", "REF:")):
            for ref in line.split(":", 1)[1].split(";"):
                ref = ref.strip()
                if ref:
                    doc, _, art = ref.partition(" ")
                    cur["refs"].append({"doc": doc, "art": art.strip()})
            continue
        if section == "step" and step is not None:
            if line.startswith(("- ", "+ ")):
                if line[0] == "+":
                    step["answer"].append(len(step["choices"]))
                step["choices"].append(line[2:].strip())
            elif line.startswith(">"):
                step["explain"] += " " + line[1:].strip()
            elif line.strip():
                if step["explain"]:
                    step["explain"] += " " + line.strip()
                elif step["choices"]:
                    step["choices"][-1] += " " + line.strip()
                else:
                    step["q"] += " " + line.strip()
            continue
        if section in ("context", "debrief"):
            cur[section] += (line.strip() if line.strip() else "\n") + ("\n" if line.strip() else "")
            continue
        if line.strip():
            raise ContentError(f"{path.name}:{n} texte inattendu : {line!r}")
    finish()
    for c in cases:
        for key in ("context", "debrief"):
            c[key] = re.sub(r"\n{3,}", "\n\n", c[key]).strip()
    return cases


# --------------------------------------------------------------------------- fiches et glossaire

def parse_fiche(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"\s*<!--(.*?)-->\s*(.*)$", text, re.S)
    if not m:
        raise ContentError(f"{path.name} : en-tête <!-- ... --> manquant")
    meta: dict = {}
    for line in m.group(1).strip().splitlines():
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip()
    for key in ("id", "title", "summary"):
        if not meta.get(key):
            raise ContentError(f"{path.name} : champ {key} manquant")
    refs = []
    for part in filter(None, (p.strip() for p in meta.get("refs", "").split(";"))):
        ref, _, label = part.partition("|")
        doc, _, art = ref.strip().partition(" ")
        refs.append({"doc": doc, "art": art.strip(), "label": label.strip() or ref.strip()})
    return {"id": meta["id"], "title": meta["title"], "summary": meta["summary"],
            "levels": meta.get("levels", " ".join(LEVELS)).split(), "refs": refs,
            "html": re.sub(r"\n\s*", "\n", m.group(2).strip())}


def parse_glossary(path: Path) -> list[dict]:
    items = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        term, sep, definition = line.partition("::")
        if not sep:
            raise ContentError(f"{path.name}:{n} séparateur « :: » manquant")
        items.append({"term": term.strip(), "def": definition.strip()})
    return sorted(items, key=lambda x: x["term"].lower())


# --------------------------------------------------------------------------- validation

def validate(questions: list[dict], cases: list[dict], catalog: dict, lenient: bool = False) -> list[str]:
    errors: list[str] = []
    warnings: list[str] = []
    doc_codes = {d.get("code", d["id"]) for d in catalog.get("docs", [])}
    seen: set[str] = set()
    for q in questions + cases:
        if q["id"] in seen:
            errors.append(f"identifiant en double : {q['id']}")
        seen.add(q["id"])
        bad = [lv for lv in q.get("levels", []) if lv not in LEVELS]
        if bad:
            errors.append(f"{q['id']} : niveau(x) inconnu(s) {bad}")
    for q in questions:
        if q.get("theme") not in THEMES:
            errors.append(f"{q['id']} : thème inconnu {q.get('theme')!r}")
        if not 1 <= q.get("difficulty", 1) <= 3:
            errors.append(f"{q['id']} : difficulté hors 1..3")
        if len(set(q["choices"])) != len(q["choices"]):
            errors.append(f"{q['id']} : propositions en double")
        ref = q.get("ref")
        if not ref:
            errors.append(f"{q['id']} : référence (R:) manquante")
        elif doc_codes and ref["doc"] not in doc_codes:
            (warnings if lenient else errors).append(f"{q['id']} : document {ref['doc']} absent du catalogue")
    for c in cases:
        for r in c["refs"]:
            if doc_codes and r["doc"] not in doc_codes:
                (warnings if lenient else errors).append(f"{c['id']} : document {r['doc']} absent du catalogue")
    for w in warnings:
        print("avertissement :", w, file=sys.stderr)
    return errors


# --------------------------------------------------------------------------- précache

def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_precache(site: Path) -> tuple[dict, str]:
    core, pdfs = [], []
    core_size = pdf_size = 0
    h = hashlib.sha256()
    for p in sorted(site.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(site).as_posix()
        if rel in EXCLUDE_CORE or rel.startswith(EXCLUDE_PREFIX) or rel.startswith(".") or "/." in rel:
            continue
        if rel.startswith("reglements/pdf/"):
            pdfs.append(rel)
            pdf_size += p.stat().st_size
            h.update(rel.encode() + file_hash(p).encode())
        elif p.suffix.lower() in CORE_EXT:
            core.append(rel)
            core_size += p.stat().st_size
            h.update(rel.encode() + file_hash(p).encode())
    build = h.hexdigest()[:12]
    manifest = {"build": build, "core": ["./"] + core, "coreSize": core_size,
                "pdf": pdfs, "pdfSize": pdf_size}
    return manifest, build


def bump_sw(site: Path, build: str) -> bool:
    sw = site / "sw.js"
    if not sw.exists():
        return False
    text = sw.read_text(encoding="utf-8")
    new = re.sub(r"const BUILD = '[^']*';", f"const BUILD = '{build}';", text, count=1)
    if new != text:
        sw.write_text(new, encoding="utf-8")
        return True
    return False


def dump(path: Path, data) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=str(ROOT / "docs"))
    ap.add_argument("--content", default=str(ROOT / "content"))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--lenient", action="store_true",
                    help="références à des documents absents du catalogue signalées sans bloquer (bot)")
    args = ap.parse_args(argv)
    site, content = Path(args.site), Path(args.content)

    try:
        questions = [q for f in sorted((content / "questions").glob("*.txt")) for q in parse_questions(f)]
        cases = [c for f in sorted((content / "cases").glob("*.txt")) for c in parse_cases(f)]
        fiches = [parse_fiche(f) for f in sorted((content / "fiches").glob("*.html"))]
        glossary = parse_glossary(content / "glossaire.txt") if (content / "glossaire.txt").exists() else []
    except ContentError as err:
        print(f"ERREUR de contenu : {err}", file=sys.stderr)
        return 2
    catalog_path = site / "data" / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else {}
    errors = validate(questions, cases, catalog, lenient=args.lenient)
    if errors:
        for e in errors:
            print("ERREUR :", e, file=sys.stderr)
        return 2

    stats = {lv: sum(1 for q in questions if lv in q["levels"]) for lv in LEVELS}
    by_theme = {t: sum(1 for q in questions if q["theme"] == t) for t in THEMES}
    outputs = {
        site / "data" / "questions.json": dump(None, {"themes": THEMES, "count": len(questions),
                                                       "byLevel": stats, "byTheme": by_theme,
                                                       "questions": questions}),
        site / "data" / "cases.json": dump(None, {"count": len(cases), "cases": cases}),
        site / "data" / "fiches.json": dump(None, fiches),
        site / "data" / "glossaire.json": dump(None, glossary),
    }
    stale = []
    for path, text in outputs.items():
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old != text:
            stale.append(path)
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
    manifest, build = write_precache(site)
    pre_path = site / "data" / "precache.json"
    pre_text = json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"
    old_pre = pre_path.read_text(encoding="utf-8") if pre_path.exists() else None
    if old_pre != pre_text:
        stale.append(pre_path)
        if not args.check:
            pre_path.write_text(pre_text, encoding="utf-8")
    sw_text = (site / "sw.js").read_text(encoding="utf-8") if (site / "sw.js").exists() else ""
    if f"const BUILD = '{build}';" not in sw_text:
        stale.append(site / "sw.js")
        if not args.check:
            bump_sw(site, build)

    print(f"{len(questions)} questions ({', '.join(f'{k} {v}' for k, v in stats.items())}), "
          f"{len(cases)} cas pratiques, {len(fiches)} fiches, {len(glossary)} termes, build {build}")
    print("par thème : " + ", ".join(f"{k} {v}" for k, v in by_theme.items()))
    if args.check and stale:
        print("Fichiers générés obsolètes, lancez : python scripts/build_site.py", file=sys.stderr)
        for p in stale:
            print("  -", p, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
