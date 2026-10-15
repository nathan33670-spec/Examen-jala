#!/usr/bin/env python3
"""Bot de mise à jour des règlements FFBaD.

Interroge l'API publique du Guide du Badminton (https://gdb.ffbad.org), télécharge
les chapitres utiles aux juges-arbitres, détecte les nouvelles versions (empreinte
SHA-256), extrait le texte pour la lecture hors-ligne dans l'application et produit :

- docs/reglements/pdf/...            les PDF officiels ;
- docs/reglements/text/<id>.json     le texte structuré de chaque document ;
- docs/data/catalog.json             le catalogue affiché dans l'application ;
- docs/data/updates.json             l'historique des mises à jour détectées ;
- un rapport Markdown (questions potentiellement impactées) pour l'issue / la PR.

Dépendances : Python 3.9+, pypdf (liens et repli d'extraction), pdftotext (poppler)
recommandé pour une meilleure extraction du texte.

Usage :
    python bot/update_regulations.py --site docs --report /tmp/rapport.md
"""
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "examen-ja-bot/1.0 (+https://github.com/; mise a jour des reglements FFBaD)"
FILENAME_RE = re.compile(r"^GUI(\d{2})\.(\d{2})(?:([AF])(\d{1,2}))?", re.I)


# --------------------------------------------------------------------------- réseau

def http_get(url: str, *, retries: int = 4, timeout: int = 60) -> bytes:
    """GET avec nouvelles tentatives (2s, 4s, 8s, 16s)."""
    delay = 2
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last_err = err
            if isinstance(err, urllib.error.HTTPError) and err.code in (400, 401, 403, 404):
                break
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
    raise RuntimeError(f"Échec du téléchargement de {url} : {last_err}")


def get_json(url: str):
    return json.loads(http_get(url).decode("utf-8"))


# --------------------------------------------------------------------------- saisons

def season_for(date: dt.date) -> str:
    """La saison sportive FFBaD commence le 1er septembre."""
    start = date.year if date.month >= 9 else date.year - 1
    return f"{start}-{start + 1}"


def pick_current_season(seasons: list[str], today: dt.date) -> str:
    wanted = season_for(today)
    if wanted in seasons:
        return wanted
    older = sorted(s for s in seasons if s <= wanted)
    return older[-1] if older else sorted(seasons)[0]


# --------------------------------------------------------------------------- arbre GdB

def walk_tree(folders: list[dict], path: tuple[str, ...] = ()):
    for folder in folders:
        here = path + (folder.get("name", ""),)
        for f in folder.get("files", []) or []:
            yield here, f
        yield from walk_tree(folder.get("folders") or folder.get("children") or [], here)


def doc_id_from_filename(filename: str) -> str | None:
    m = FILENAME_RE.match(filename)
    if not m:
        return None
    a, b, kind, num = m.groups()
    doc_id = f"{a}.{b}"
    if kind:
        doc_id += f".{kind.upper()}{int(num):02d}"
    return doc_id


def clean_title(name: str) -> str:
    return re.sub(r"^\s*\d{2}\.\d{2}(?:[.\s]?[AF]\d{1,2})?\s+", "", name).strip()


def matches(filename: str, cfg: dict) -> bool:
    if any(fnmatch.fnmatch(filename, p) for p in cfg.get("exclude", [])):
        return False
    if cfg.get("all"):
        return True
    return any(fnmatch.fnmatch(filename, p) for p in cfg.get("include", []))


# --------------------------------------------------------------------------- PDF

def pdf_links(path: Path) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover
        return []
    links: list[str] = []
    try:
        reader = PdfReader(str(path))
        for page in reader.pages:
            for annot in page.get("/Annots") or []:
                obj = annot.get_object()
                action = obj.get("/A")
                if action is not None:
                    uri = action.get_object().get("/URI")
                    if uri:
                        links.append(str(uri))
    except Exception:  # PDF exotique : on ignore
        pass
    return links


def pdf_page_count(path: Path) -> int | None:
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(path)).pages)
    except Exception:
        return None


def pdf_to_text(path: Path) -> str:
    if shutil.which("pdftotext"):
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
                             capture_output=True, check=False)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.decode("utf-8", errors="replace")
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        return "\f".join((p.extract_text(extraction_mode="layout") or "") for p in reader.pages)
    except Exception:
        return ""


META_PATTERNS = {
    "adoption": r"adoption\s*:\s*(.+?)(?:\s{2,}|$)",
    "effective": r"entr[ée]e\s+en\s+vigueur\s*:\s*(.+?)(?:\s{2,}|$)",
    "replaces": r"remplace\s*:\s*(.+?)(?:\s{2,}|$)",
    "validity": r"validit[ée]\s*:?\s*:\s*(.+?)(?:\s{2,}|$)",
    "pagesDeclared": r"nombre\s+de\s+pages\s*:\s*(.+?)(?:\s{2,}|$)",
}
FOOTER_RE = re.compile(
    r"(FFBA?D?\s*/\s*GdB\s*/|^\s*page\s+\d+\s*$|Mise\s+à\s+jour\s*:\s*\d{1,2}\s+\w+\s+\d{4}\s*\d*\s*$)",
    re.I)
TOC_RE = re.compile(r"\.{5,}|…{3,}")
LIST_RE = re.compile(r"^([–—•\-▪◦]|[a-z]\)|\(?[ivx]+\))\s+")
NUM_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,5})\.?\s+(\S.*)$")


def extract_meta(first_page: str) -> dict:
    meta: dict[str, str] = {}
    for line in first_page.splitlines():
        for key, pat in META_PATTERNS.items():
            if key in meta:
                continue
            m = re.search(pat, line.strip(), re.I)
            if m:
                value = re.sub(r"\s+", " ", m.group(1)).strip(" :")
                if value:
                    meta[key] = value
    m = re.search(r"[ée]dition\s*[–-]\s*(\d{4}/\d+)", first_page)
    if m:
        meta["edition"] = m.group(1)
    else:
        m = re.search(r"[ÉE]dition\s*:\s*([A-Za-zéû]+\s+\d{4})", first_page)
        if m:
            meta["edition"] = m.group(1)
    m = re.search(r"Mise\s+à\s+jour\s*:\s*(\d{1,2}(?:er)?\s+\w+\s+\d{4})", first_page)
    if m:
        meta["revised"] = m.group(1)
    return meta


def _ends_sentence(text: str) -> bool:
    return bool(re.search(r"[.;:!?»)]\s*$", text))


def _norm(line: str) -> str:
    return re.sub(r"\s{2,}", " ", line).strip()


def _running_headers(pages: list[str]) -> set[str]:
    """Lignes courtes répétées sur de nombreuses pages (en-têtes / pieds de page)."""
    if len(pages) < 3:
        return set()
    counts: dict[str, int] = {}
    for page in pages:
        for line in {_norm(l) for l in page.splitlines()}:
            if line and len(line) < 80:
                counts[line] = counts.get(line, 0) + 1
    return {l for l, n in counts.items() if n >= max(3, len(pages) * 0.3)}


def _is_numbered(num: re.Match | None, line: str) -> bool:
    if not num:
        return False
    first = num.group(2)[:1]
    has_dot = "." in num.group(1) or line[len(num.group(1)):len(num.group(1)) + 1] == "."
    return has_dot and (first.isupper() or first in "«\"(–-")


def structure_text(raw: str, title: str) -> tuple[dict, list[list[str]]]:
    pages = raw.split("\f")
    meta = extract_meta(pages[0] if pages else "")
    headers = _running_headers(pages)
    blocks: list[list[str]] = []
    cur: list[str] | None = None

    def close():
        nonlocal cur
        if cur and cur[1].strip():
            blocks.append([cur[0], re.sub(r"\s+", " ", cur[1]).strip()])
        cur = None

    title_key = re.sub(r"\W+", "", title.lower())[:40]
    for page_no, page in enumerate(pages):
        raw_lines = page.splitlines()
        if page_no == 0:
            for i, line in enumerate(raw_lines):
                if "grammes de plumes" in line:
                    raw_lines = raw_lines[i + 1:]
                    break
        lines = []
        for raw_line in raw_lines:
            if FOOTER_RE.search(raw_line) or TOC_RE.search(raw_line) or "grammes de plumes" in raw_line:
                continue
            line = _norm(raw_line)
            if not line or line in headers or re.fullmatch(r"\d{1,3}", line):
                continue  # vide, en-tête répété ou numéro de page isolé
            if title_key and re.sub(r"\W+", "", line.lower())[:40] == title_key:
                continue
            lines.append(line)
        for idx, line in enumerate(lines):
            nxt = lines[idx + 1] if idx + 1 < len(lines) else ""
            num = NUM_RE.match(line)
            numbered = _is_numbered(num, line)
            upper_ratio = sum(c.isupper() for c in line) / max(1, sum(c.isalpha() for c in line))
            # une ligne suivie d'une suite en minuscule est le début d'un paragraphe, pas un titre
            continues = bool(nxt) and (nxt[:1].islower() or bool(re.match(r"^\d+[\s,]+[a-zà-ÿ]", nxt)))
            if numbered and len(num.group(2)) <= 80 and not _ends_sentence(line) and len(line) < 90 \
                    and not continues:
                close()
                depth = num.group(1).count(".") + 1
                blocks.append([f"h{min(4, depth + 1)}", line])
                continue
            if re.match(r"^(ANNEXE|Annexe|SCH[ÉE]MA|Schéma)\b", line) and len(line) < 70:
                close()
                blocks.append(["h3", line])
                continue
            if upper_ratio > 0.8 and len(line) < 70 and sum(c.isalpha() for c in line) > 4:
                close()
                blocks.append(["h3", line])
                continue
            if LIST_RE.match(line):
                close()
                cur = ["li", LIST_RE.sub("", line, count=1)]
                continue
            if numbered:
                close()
                cur = ["p", line]
                continue
            if cur is not None and not _ends_sentence(cur[1]):
                cur[1] = cur[1] + ("" if cur[1].endswith("-") else " ") + line
            else:
                close()
                cur = ["p", line]
        # changement de page : on conserve le paragraphe en cours (texte coupé)
    close()
    return meta, blocks


# --------------------------------------------------------------------------- utilitaires

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def dump_json(path: Path, data, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)


# --------------------------------------------------------------------------- synchronisation

class Sync:
    def __init__(self, site: Path, cfg: dict, today: dt.date, offline_dir: Path | None = None,
                 reextract: bool = False):
        self.site = site
        self.reextract = reextract
        self.cfg = cfg
        self.today = today
        self.offline_dir = offline_dir
        self.api = cfg.get("api", "https://gdb.ffbad.org").rstrip("/")
        self.catalog_path = site / "data" / "catalog.json"
        self.old = load_json(self.catalog_path, {"docs": []})
        self.old_docs = {d["id"]: d for d in self.old.get("docs", [])}
        self.docs: list[dict] = []
        self.changes: list[dict] = []
        self.errors: list[str] = []

    # -- fichiers locaux
    def pdf_rel(self, filename: str, season: str | None) -> str:
        sub = f"a-venir/{season}/" if season else ""
        return f"reglements/pdf/{sub}{safe_name(filename)}"

    def text_rel(self, doc_id: str) -> str:
        return f"reglements/text/{safe_name(doc_id)}.json"

    def fetch_pdf(self, url: str, filename: str) -> bytes:
        if self.offline_dir:
            for cand in self.offline_dir.rglob(filename):
                return cand.read_bytes()
        return http_get(url)

    def process(self, *, doc_id: str, title: str, folder: str, filename: str, url: str,
                season: str, upcoming: bool) -> dict | None:
        try:
            data = self.fetch_pdf(url, filename)
        except Exception as err:  # on conserve l'ancienne version en cas d'erreur réseau
            self.errors.append(f"{doc_id} : {err}")
            prev = self.old_docs.get(doc_id)
            if prev:
                self.docs.append(prev)
            return prev
        if not data.startswith(b"%PDF"):
            self.errors.append(f"{doc_id} : contenu reçu non PDF ({url})")
            prev = self.old_docs.get(doc_id)
            if prev:
                self.docs.append(prev)
            return prev
        digest = sha256(data)
        prev = self.old_docs.get(doc_id)
        pdf_rel = self.pdf_rel(filename, season if upcoming else None)
        text_rel = self.text_rel(doc_id)
        pdf_path = self.site / pdf_rel
        text_path = self.site / text_rel
        unchanged = prev and prev.get("sha256") == digest and pdf_path.exists() and text_path.exists()
        if unchanged and prev.get("pdf") == pdf_rel:
            if self.reextract:  # amélioration de l'extraction : texte régénéré, document inchangé
                meta, blocks = structure_text(pdf_to_text(pdf_path), title)
                dump_json(text_path, {"id": doc_id, "title": title, "season": season, "blocks": blocks},
                          compact=True)
                prev = {**prev, **meta, "title": title}
            self.docs.append(prev)
            return prev

        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(data)
        raw = pdf_to_text(pdf_path)
        meta, blocks = structure_text(raw, title)
        dump_json(text_path, {"id": doc_id, "title": title, "season": season, "blocks": blocks},
                  compact=True)
        entry = {
            "id": doc_id,
            "code": doc_id.split("@")[0],
            "title": title,
            "folder": folder,
            "filename": filename,
            "season": season,
            "upcoming": upcoming,
            "source": url,
            "pdf": pdf_rel,
            "text": text_rel,
            "size": len(data),
            "pages": pdf_page_count(pdf_path),
            "sha256": digest,
            "updatedAt": self.today.isoformat(),
            **meta,
        }
        if prev and prev.get("pdf") and prev.get("pdf") != pdf_rel:
            old_file = self.site / prev["pdf"]
            if old_file.exists():
                old_file.unlink()
        self.docs.append(entry)
        if not prev:
            self.changes.append({"id": doc_id, "title": title, "type": "nouveau", "season": season})
        elif prev.get("sha256") != digest:
            self.changes.append({"id": doc_id, "title": title, "type": "modifié", "season": season,
                                 "previousEdition": prev.get("edition"), "edition": meta.get("edition")})
        return entry

    def run(self) -> None:
        seasons = get_json(f"{self.api}/api/seasons")
        current = pick_current_season(seasons, self.today)
        targets = [current]
        if self.cfg.get("upcoming_seasons"):
            targets += sorted(s for s in seasons if s > current)
        self.season = current
        self.seasons = seasons
        rules_parent: dict | None = None
        for season in targets:
            tree = get_json(f"{self.api}/api/tree/{urllib.parse.quote(season)}")
            upcoming = season != current
            for path, f in walk_tree(tree.get("folders", [])):
                filename = f.get("filename") or os.path.basename(f.get("url", ""))
                if not filename.lower().endswith(".pdf") or not matches(filename, self.cfg):
                    continue
                code = doc_id_from_filename(filename)
                if not code:
                    continue
                doc_id = f"{code}@{season}" if upcoming else code
                url = urllib.parse.urljoin(self.api + "/", f.get("url", ""))
                entry = self.process(doc_id=doc_id, title=clean_title(f.get("name", filename)),
                                     folder=path[0] if path else "", filename=filename, url=url,
                                     season=season, upcoming=upcoming)
                if not upcoming and entry and code == "03.00":
                    rules_parent = entry
        self.process_extras(rules_parent)
        self.detect_removed()

    def process_extras(self, rules_parent: dict | None) -> None:
        for extra in self.cfg.get("extra", []):
            url = None
            if rules_parent and extra.get("discover_from") == rules_parent.get("code"):
                for link in pdf_links(self.site / rules_parent["pdf"]):
                    if extra.get("discover_host", "") in link:
                        url = link.rstrip("/")
                        if "/s/" in url and not url.endswith("/download"):
                            url += "/download"
                        break
            url = url or extra.get("fallback_url")
            if not url:
                continue
            self.process(doc_id=extra["id"], title=extra["title"], folder=extra.get("folder", ""),
                         filename=extra["filename"], url=url, season=self.season, upcoming=False)

    def detect_removed(self) -> None:
        current_ids = {d["id"] for d in self.docs}
        for doc_id, prev in self.old_docs.items():
            if doc_id in current_ids:
                continue
            for key in ("pdf", "text"):
                p = self.site / prev.get(key, "")
                if prev.get(key) and p.is_file():
                    p.unlink()
            self.changes.append({"id": doc_id, "title": prev.get("title"), "type": "retiré",
                                 "season": prev.get("season")})

    # -- écriture
    def write(self) -> bool:
        changed = bool(self.changes) or self.reextract or not self.catalog_path.exists()
        if not changed:
            return False
        self.docs.sort(key=lambda d: (d.get("upcoming", False), d["code"], d["id"]))
        catalog = {
            "source": self.api,
            "season": self.season,
            "seasons": self.seasons,
            "generatedAt": self.today.isoformat(),
            "count": len(self.docs),
            "totalSize": sum(d.get("size", 0) for d in self.docs),
            "docs": self.docs,
        }
        dump_json(self.catalog_path, catalog)
        updates_path = self.site / "data" / "updates.json"
        updates = load_json(updates_path, [])
        if self.changes and not self.old_docs:
            updates.insert(0, {"date": self.today.isoformat(), "season": self.season, "changes": [],
                               "note": f"Import initial de {len(self.docs)} documents du Guide du Badminton."})
        elif self.changes:
            updates.insert(0, {"date": self.today.isoformat(), "season": self.season,
                               "changes": self.changes})
        dump_json(updates_path, updates[:60])
        return True

    def report(self, questions_path: Path) -> str:
        lines = [f"## Mise à jour des règlements FFBaD — {self.today.isoformat()}", "",
                 f"Saison de référence : **{self.season}** (source : {self.api})", ""]
        if not self.changes:
            lines.append("Aucun changement détecté.")
        else:
            lines.append("| Document | Changement | Édition |")
            lines.append("|---|---|---|")
            for c in self.changes:
                ed = c.get("edition") or ""
                if c.get("previousEdition") and c.get("previousEdition") != ed:
                    ed = f"{c['previousEdition']} → {ed}"
                lines.append(f"| {c['id']} — {c.get('title','')} | {c['type']} | {ed} |")
            impacted = impacted_questions(questions_path, {c["id"].split("@")[0] for c in self.changes})
            lines += ["", f"### Questions à relire ({len(impacted)})", ""]
            if impacted:
                lines.append("Ces questions citent un document modifié : vérifier que la réponse et "
                             "l'explication restent exactes, puis mettre à jour `content/`.")
                lines.append("")
                for q in impacted[:200]:
                    ref = q.get("ref", {})
                    lines.append(f"- [ ] `{q['id']}` ({ref.get('doc')} {ref.get('art','')}) — {q['q'][:110]}")
                if len(impacted) > 200:
                    lines.append(f"- … et {len(impacted) - 200} autres")
            else:
                lines.append("Aucune question ne cite directement ces documents.")
        if self.errors:
            lines += ["", "### Erreurs", ""] + [f"- {e}" for e in self.errors]
        return "\n".join(lines) + "\n"


def impacted_questions(path: Path, codes: set[str]) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("questions", data) if isinstance(data, dict) else data
    out = []
    for q in items:
        doc = (q.get("ref") or {}).get("doc", "")
        if doc in codes or any(doc.startswith(c + ".") for c in codes):
            out.append(q)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=str(ROOT / "docs"), help="racine du site (défaut : docs)")
    ap.add_argument("--config", default=str(ROOT / "bot" / "sources.json"))
    ap.add_argument("--report", help="chemin du rapport Markdown à écrire")
    ap.add_argument("--today", help="date de référence AAAA-MM-JJ (tests)")
    ap.add_argument("--offline-dir", help="répertoire local de PDF (tests sans réseau)")
    ap.add_argument("--no-build", action="store_true", help="ne pas relancer scripts/build_site.py")
    ap.add_argument("--reextract", action="store_true",
                    help="régénérer le texte de tous les documents (après une amélioration de l'extraction)")
    args = ap.parse_args(argv)

    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    site = Path(args.site).resolve()
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    sync = Sync(site, cfg, today, Path(args.offline_dir) if args.offline_dir else None, reextract=args.reextract)
    sync.run()
    changed = sync.write()
    report = sync.report(site / "data" / "questions.json")
    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
    print(report)
    if changed and not args.no_build:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build_site.py"), "--site", str(site),
                        "--lenient"], check=True)
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as fh:
            fh.write(f"changed={'true' if changed else 'false'}\n")
            fh.write(f"count={len(sync.changes)}\n")
            fh.write(f"season={sync.season}\n")
    return 1 if sync.errors and not sync.docs else 0


if __name__ == "__main__":
    sys.exit(main())
