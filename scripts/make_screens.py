#!/usr/bin/env python3
"""Génère les écrans simplifiés (SVG) utilisés par les questions « logiciel de compétition ».

    python scripts/make_screens.py      # écrit docs/img/ecrans/*.svg

Les écrans imitent la présentation d'un logiciel de gestion de compétition (type BadNet) avec des
données fictives : ce ne sont pas des captures du logiciel. Les données de chaque écran sont
choisies pour que la réponse de la question correspondante découle du règlement (voir
content/questions/26-logiciel-competition.txt).
"""
from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "img" / "ecrans"

W = 760
FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
INK, MUTED, LINE, HEAD, ACCENT, BAD, GOOD, SOFT = "#1d2b30", "#5d6e74", "#d5dfe2", "#0f4c5c", "#e07a1f", "#c0392b", "#1e8449", "#f2f6f7"
TABS = ["Inscriptions", "Tableaux", "Échéancier", "Matchs", "Résultats"]


def t(x, y, s, size=14, color=INK, weight="normal", anchor="start"):
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{escape(str(s))}</text>')


def rect(x, y, w, h, fill, stroke="none", r=0):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}"/>'


def table(x, y, cols, rows, highlight=None, row_h=30):
    """cols : [(titre, largeur, alignement)] ; rows : listes de cellules ; highlight : {ligne: couleur}."""
    out, width = [], sum(c[1] for c in cols)
    out.append(rect(x, y, width, row_h, SOFT))
    cx = x
    for title, w, align in cols:
        ax = cx + 10 if align == "start" else cx + w / 2 if align == "middle" else cx + w - 10
        out.append(t(ax, y + 20, title, 12, MUTED, "600", align))
        cx += w
    for i, row in enumerate(rows):
        ry = y + row_h * (i + 1)
        if highlight and i in highlight:
            out.append(rect(x, ry, width, row_h, highlight[i]))
        out.append(f'<line x1="{x}" y1="{ry}" x2="{x + width}" y2="{ry}" stroke="{LINE}"/>')
        cx = x
        for (title, w, align), cell in zip(cols, row):
            ax = cx + 10 if align == "start" else cx + w / 2 if align == "middle" else cx + w - 10
            weight = "600" if isinstance(cell, str) and cell.startswith("*") else "normal"
            out.append(t(ax, ry + 20, str(cell).lstrip("*"), 13, INK, weight, align))
            cx += w
    end = y + row_h * (len(rows) + 1)
    out.append(f'<line x1="{x}" y1="{end}" x2="{x + width}" y2="{end}" stroke="{LINE}"/>')
    return "".join(out), end


def screen(name, title, subtitle, tab, body, height):
    total = height + 118
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {total}" font-family="{FONT}" role="img" aria-label="{escape(title)}">',
        rect(0, 0, W, total, "#ffffff", LINE, 10),
        rect(0, 0, W, 44, HEAD, r=10), rect(0, 30, W, 14, HEAD),
        '<circle cx="20" cy="22" r="5" fill="#ff6b5f"/><circle cx="36" cy="22" r="5" fill="#ffbd2e"/><circle cx="52" cy="22" r="5" fill="#28c840"/>',
        t(72, 27, "Gestion de compétition · Tournoi exemple de Villeneuve", 14, "#ffffff", "600"),
    ]
    x = 16
    for name_tab in TABS:
        w = 18 + len(name_tab) * 7.6
        active = name_tab == tab
        parts.append(rect(x, 52, w, 28, HEAD if active else SOFT, r=6))
        parts.append(t(x + w / 2, 71, name_tab, 12.5, "#ffffff" if active else MUTED, "600", "middle"))
        x += w + 6
    parts.append(t(16, 104, title, 16, INK, "700"))
    parts.append(t(W - 16, 104, subtitle, 12, MUTED, "normal", "end"))
    parts.append(f'<g transform="translate(0,114)">{body}</g>')
    parts.append(t(W - 12, total - 8, "Écran simplifié · données fictives", 10, MUTED, "normal", "end"))
    parts.append("</svg>")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.svg").write_text("".join(parts) + "\n", encoding="utf-8")


def badge(x, y, s, color):
    w = 14 + len(s) * 7
    return rect(x, y, w, 22, color, r=11) + t(x + w / 2, y + 15, s, 12, "#ffffff", "600", "middle")


# ------------------------------------------------------------------ écrans


def poule_triple():
    cols = [("Match", 260, "start"), ("Set 1", 90, "middle"), ("Set 2", 90, "middle"), ("Set 3", 90, "middle"), ("Vainqueur", 198, "start")]
    rows = [
        ["MARTIN Hugo – LEROY Paul", "15-10", "15-12", "", "MARTIN"],
        ["LEROY Paul – COSTA Enzo", "15-13", "11-15", "15-9", "LEROY"],
        ["COSTA Enzo – MARTIN Hugo", "15-8", "15-11", "", "COSTA"],
        ["MARTIN Hugo – DUPUIS Léo", "15-6", "15-9", "", "MARTIN"],
        ["LEROY Paul – DUPUIS Léo", "15-12", "13-15", "15-10", "LEROY"],
        ["COSTA Enzo – DUPUIS Léo", "15-7", "15-4", "", "COSTA"],
    ]
    body, end = table(16, 8, cols, rows)
    body += t(16, end + 26, "Victoires : MARTIN 2 · LEROY 2 · COSTA 2 · DUPUIS 0", 13, MUTED)
    screen("poule-triple", "Simple Hommes D8/D9 · Poule A (1 qualifié)", "Tous les matchs joués", "Résultats", body, end + 40)


def poule_double():
    cols = [("Match", 260, "start"), ("Set 1", 90, "middle"), ("Set 2", 90, "middle"), ("Set 3", 90, "middle"), ("Vainqueur", 198, "start")]
    rows = [
        ["ROUX Inès – BLANC Chloé", "15-9", "12-15", "13-15", "BLANC"],
        ["ROUX Inès – PETIT Manon", "15-4", "15-6", "", "ROUX"],
        ["ROUX Inès – GARNIER Lou", "15-7", "15-8", "", "ROUX"],
        ["BLANC Chloé – PETIT Manon", "15-13", "13-15", "15-11", "BLANC"],
        ["BLANC Chloé – GARNIER Lou", "10-15", "8-15", "", "GARNIER"],
        ["PETIT Manon – GARNIER Lou", "15-12", "15-13", "", "PETIT"],
    ]
    body, end = table(16, 8, cols, rows)
    body += t(16, end + 26, "Victoires : ROUX 2 · BLANC 2 · PETIT 1 · GARNIER 1", 13, MUTED)
    screen("poule-double", "Simple Dames P10/P11 · Poule B (1 qualifiée)", "Tous les matchs joués", "Résultats", body, end + 40)


def poule_abandon():
    cols = [("Match", 260, "start"), ("Score", 190, "middle"), ("Statut", 278, "start")]
    rows = [
        ["DIAZ Tom – NOEL Axel", "15-11 15-9", "Terminé"],
        ["FAURE Max – VIDAL Noé", "8-3", "*Abandon de VIDAL (blessure)"],
        ["DIAZ Tom – VIDAL Noé", "", "*VIDAL forfait (blessure)"],
        ["FAURE Max – NOEL Axel", "15-13 15-12", "Terminé"],
        ["DIAZ Tom – FAURE Max", "à jouer", "Programmé 11:40"],
        ["NOEL Axel – VIDAL Noé", "", "*VIDAL forfait (blessure)"],
    ]
    body, end = table(16, 8, cols, rows, highlight={1: "#fdecea", 2: "#fdecea", 5: "#fdecea"})
    body += t(16, end + 26, "Tableau en 3 poules de 4 + phase finale à élimination directe", 13, MUTED)
    screen("poule-abandon", "Simple Hommes P12 · Poule C (sur 3 poules)", "VIDAL a abandonné son premier match", "Résultats", body, end + 40)


def echeancier_repos():
    cols = [("Heure prévue", 110, "middle"), ("Terrain", 80, "middle"), ("Match", 330, "start"), ("Fin réelle", 100, "middle"), ("Statut", 108, "start")]
    rows = [
        ["09:50", "3", "SD P10 · MOREL Lina – HAMON Julie", "*10:12", "Terminé"],
        ["10:00", "1", "DH D9 · BRUN / GILLES – ROCHE / TESSIER", "10:31", "Terminé"],
        ["10:20", "2", "DD P10 · MOREL / SIMON – AUBERT / LAINE", "", "*À appeler"],
        ["10:20", "4", "SH P11 · KLEIN Marc – ROYER Hugo", "", "À appeler"],
    ]
    body, end = table(16, 8, cols, rows, highlight={0: "#eaf4ec", 2: "#fff4e5"})
    body += t(16, end + 26, "Règlement particulier : temps de repos minimum entre deux matchs = 20 minutes", 13, MUTED)
    body += t(16, end + 48, "Il est 10:20. Lina MOREL n’a rien demandé.", 13, INK, "600")
    screen("echeancier-repos", "Échéancier · samedi", "Heure actuelle 10:20", "Échéancier", body, end + 62)


def echeancier_avance():
    cols = [("Heure prévue", 120, "middle"), ("Terrain", 80, "middle"), ("Match", 390, "start"), ("Statut", 138, "start")]
    rows = [
        ["13:40", "1", "SH R5/R6 · Demi-finale 1", "En cours"],
        ["13:40", "2", "SH R5/R6 · Demi-finale 2", "En cours"],
        ["14:00", "—", "*DX R6 · ESTEVE / RENAUD – PAGES / MAURY", "*Terrain 3 libre"],
        ["14:20", "—", "DX R6 · BOYER / LUCAS – CAMUS / DURAND", "En attente"],
    ]
    body, end = table(16, 8, cols, rows, highlight={2: "#fff4e5"})
    body += t(16, end + 26, "Joueurs présents et reposés. Terrain 3 libre depuis 12:50.", 13, INK, "600")
    screen("echeancier-avance", "Échéancier · dimanche", "Heure actuelle 12:50", "Échéancier", body, end + 40)


def appel_forfait():
    cols = [("Match", 330, "start"), ("Terrain", 80, "middle"), ("Appel", 90, "middle"), ("Présents sur le terrain", 228, "start")]
    rows = [["SD D8 · FONTAINE Zoé – MERCIER Anna", "5", "*15:02", "*FONTAINE seulement"]]
    body, end = table(16, 8, cols, rows, highlight={0: "#fff4e5"})
    body += t(16, end + 30, "Il est 15:08. Anna MERCIER ne s’est pas présentée et n’a donné aucune nouvelle.", 13, INK, "600")
    screen("appel-forfait", "Matchs appelés", "Heure actuelle 15:08", "Matchs", body, end + 44)


def tds_nombre():
    cols = [("Joueur", 260, "start"), ("Club", 150, "start"), ("Cote CPPH", 120, "end"), ("Tête de série", 198, "middle")]
    names = ["ARNAUD Théo", "BENOIT Sami", "CHARLES Yanis", "DENIS Malo", "ETIENNE Rémi", "FABRE Noa", "GUERIN Adam", "HENRY Liam",
             "IBERT Côme", "JOLY Tim", "KAHN Ilan", "LAMBERT Ugo", "MASSON Evan", "NICOLAS Jules", "OLIVIER Paul", "PERRIN Eli"]
    cotes = [1420, 1388, 1306, 1290, 1255, 1231, 1197, 1180, 1163, 1150, 1122, 1101, 1087, 1060, 1042, 1015]
    clubs = ["BC Villeneuve", "AS Lacroix", "BC Saint-Roch", "Volant d'Or", "AS Lacroix", "BC Villeneuve", "Bad Club 47", "Volant d'Or",
             "BC Saint-Roch", "Bad Club 47", "AS Lacroix", "BC Villeneuve", "Volant d'Or", "Bad Club 47", "BC Saint-Roch", "AS Lacroix"]
    rows = [[n, c, f"{v:,}".replace(",", " "), f"*{i + 1}" if i < 8 else ""] for i, (n, c, v) in enumerate(zip(names, clubs, cotes))]
    body, end = table(16, 8, cols, rows, row_h=26)
    body += badge(16, end + 14, "Proposition automatique : 8 têtes de série", ACCENT)
    screen("tds-nombre", "Simple Hommes R4/R5 · 16 inscrits · élimination directe", "Avant tirage au sort", "Inscriptions", body, end + 44)


def tds_placement():
    cols = [("Ligne", 70, "middle"), ("Joueur", 300, "start"), ("Tête de série", 130, "middle"), ("Quart", 228, "start")]
    seeds = {1: "TS 1", 5: "TS 3", 9: "TS 2", 12: "TS 4"}
    rows = []
    for line in range(1, 17):
        rows.append([str(line), "Joueur tiré au sort" if line not in seeds else f"*{seeds[line].replace('TS', 'Tête de série n°')}",
                     f"*{seeds[line]}" if line in seeds else "", ("1er quart" if line == 1 else f"{(line - 1) // 4 + 1}e quart") if line % 4 == 1 else ""])
    body, end = table(16, 8, cols, rows, highlight={0: "#eaf4ec", 4: "#eaf4ec", 8: "#eaf4ec", 11: "#eaf4ec"}, row_h=24)
    screen("tds-placement", "Tableau Simple Dames R6 · 16 places", "Placement des têtes de série (avant validation)", "Tableaux", body, end + 12)


def plus_1000():
    cols = [("Joueuse", 300, "start"), ("Classement", 140, "middle"), ("Cote CPPH", 140, "end"), ("Inscription", 148, "middle")]
    data = [("VALLET Emma", "R5", 1480), ("MAILLARD Léa", "R6", 1210), ("CARON Jade", "D7", 980), ("BAILLY Rose", "D8", 870),
            ("MOULIN Alice", "D8", 760), ("GIRAUD Lucie", "D9", 640), ("RENARD Mia", "P10", 455), ("BRUNET Clara", "P10", 430)]
    rows = [[n, c, f"{v:,}".replace(",", " "), "Validée"] for n, c, v in data]
    body, end = table(16, 8, cols, rows)
    body += t(16, end + 26, "Tableau unique « Simple Dames toutes séries » (tournoi seniors, ni championnat ni catégorie d’âge)", 12.5, MUTED)
    screen("plus-1000", "Simple Dames · 8 inscrites · élimination directe", "Inscriptions closes", "Inscriptions", body, end + 40)


def serie_inferieure():
    cols = [("Joueur", 280, "start"), ("Simple", 110, "middle"), ("Double", 110, "middle"), ("Mixte", 110, "middle"), ("Tableau demandé", 118, "middle")]
    rows = [["AUBRY Nathan", "D7", "D8", "D7", "D7/D8"], ["BERGER Louis", "D8", "D8", "D9", "D7/D8"],
            ["COLIN Raphaël", "R6", "D7", "D7", "D7/D8"], ["DUMAS Simon", "D9", "D9", "P10", "D7/D8"]]
    body, end = table(16, 8, cols, rows)
    body += t(16, end + 26, "Classements par discipline au moment de l’inscription · Tableau : Simple Hommes série D7/D8", 12.5, MUTED)
    screen("serie-inferieure", "Inscriptions · Simple Hommes D7/D8", "Contrôle avant tirage", "Inscriptions", body, end + 40)


def saisie_abandon():
    body = rect(16, 8, 728, 150, SOFT, LINE, 8)
    body += t(32, 38, "SH D9 · Quart de finale · Terrain 2", 14, INK, "700")
    body += t(32, 70, "MARTIN Hugo", 14, INK, "600") + t(32, 98, "LEROY Paul", 14, INK, "600")
    for i, (a, b) in enumerate([(15, 10), (9, 12)]):
        x = 330 + i * 90
        body += t(x, 50, f"Set {i + 1}", 12, MUTED, "600", "middle")
        body += t(x, 70, a, 16, INK, "700", "middle") + t(x, 98, b, 16, INK, "700", "middle")
    body += badge(32, 116, "LEROY abandonne (blessure) pendant le set 2", BAD)
    body += t(32, 186, "Quel score saisir pour ce match ?", 14, INK, "600")
    screen("saisie-abandon", "Saisie d’un résultat", "Match interrompu", "Matchs", body, 200)


def saisie_forfait():
    body = rect(16, 8, 728, 120, SOFT, LINE, 8)
    body += t(32, 38, "SD P11 · Poule A · Terrain 6", 14, INK, "700")
    body += t(32, 70, "PICARD Lola", 14, INK, "600") + t(32, 98, "LEBLANC Nina", 14, INK, "600")
    body += badge(400, 58, "Forfait de LEBLANC", BAD)
    body += t(400, 104, "Score à enregistrer : ?", 14, INK, "600")
    screen("saisie-forfait", "Saisie d’un résultat", "Forfait constaté par le JA", "Matchs", body, 140)


def volants():
    cols = [("Terrain", 80, "middle"), ("Match", 400, "start"), ("Classements", 248, "start")]
    rows = [["1", "SH · TISSOT Arno – VERDIER Gabin", "P10 – D9"], ["2", "SD · NAVARRO Elsa – LEMOINE Iris", "P11 – P12"]]
    body, end = table(16, 8, cols, rows)
    body += t(16, end + 26, "Pas de volant imposé par le règlement particulier pour ces séries.", 12.5, MUTED)
    screen("volants", "Matchs en cours", "Samedi 11:05", "Matchs", body, end + 40)


def poules_inegales():
    body = ""
    for i, (name, ts, n) in enumerate([("Poule A", "TS 1", 4), ("Poule B", "TS 2", 3), ("Poule C", "TS 3", 3)]):
        x = 16 + i * 246
        body += rect(x, 8, 232, 40 + n * 28, SOFT, LINE, 8)
        body += t(x + 12, 32, f"{name} · {n} joueurs", 14, INK, "700")
        for k in range(n):
            label = f"{ts} (1re place)" if k == 0 else f"Joueur {k + 1}"
            body += t(x + 12, 62 + k * 28, label, 13, INK, "600" if k == 0 else "normal")
    body += t(16, 186, "10 inscrits · 3 poules · 1er de chaque poule + meilleur 2e en phase finale", 12.5, MUTED)
    screen("poules-inegales", "Simple Hommes P12 · Constitution des poules", "Proposition avant validation", "Tableaux", body, 200)


def sortie_poules():
    cols = [("Ligne", 70, "middle"), ("Qualifié", 330, "start"), ("Demi-tableau", 328, "start")]
    rows = [["1", "1er poule A", "Haut"], ["2", "2e poule C", "Haut"], ["3", "1er poule B", "Haut"], ["4", "2e poule A", "Haut"],
            ["5", "1er poule C", "Bas"], ["6", "2e poule D", "Bas"], ["7", "2e poule B", "Bas"], ["8", "1er poule D", "Bas"]]
    body, end = table(16, 8, cols, rows, row_h=26)
    screen("sortie-poules", "Double Mixte D9 · Tableau final (4 poules, 2 qualifiés par poule)", "Tirage de sortie de poules", "Tableaux", body, end + 12)


def publication():
    cols = [("Élément", 330, "start"), ("Publication prévue", 200, "middle"), ("Statut", 198, "start")]
    rows = [["Tableaux de toutes les séries", "samedi 08:30", "Programmé"], ["Échéancier (programme horaire)", "samedi 08:30", "Programmé"],
            ["Premier match de la compétition", "samedi 09:00", ""]]
    body, end = table(16, 8, cols, rows)
    screen("publication", "Publication", "Préparation de la compétition", "Tableaux", body, end + 12)


def fin_tardive():
    cols = [("Heure prévue", 120, "middle"), ("Terrain", 80, "middle"), ("Match", 360, "start"), ("Fin estimée", 168, "middle")]
    rows = [["18:10", "1", "Finale DX R4/R5", "18:45"], ["18:20", "2", "Finale SH D7/D8", "18:55"], ["18:45", "1", "Finale DH R4/R5", "19:25"]]
    body, end = table(16, 8, cols, rows)
    body += t(16, end + 26, "Dimanche, lundi non férié · tournoi ouvert à toutes les ligues · aucune dérogation", 12.5, MUTED)
    screen("fin-tardive", "Échéancier · dimanche, fin de compétition", "Version provisoire", "Échéancier", body, end + 40)


def export_poona():
    body = rect(16, 8, 728, 132, SOFT, LINE, 8)
    body += t(32, 38, "Compétition terminée dimanche à 18:40", 14, INK, "700")
    body += badge(32, 54, "Exporter les résultats (fichier compatible Poona)", HEAD)
    body += t(32, 108, "Tournoi autorisé par la ligue · GEO désigné : Mme FERRAND · JA : M. ROLLAND", 13, INK)
    screen("export-poona", "Clôture de la compétition", "Résultats complets", "Résultats", body, 150)


ALL = [poule_triple, poule_double, poule_abandon, echeancier_repos, echeancier_avance, appel_forfait, tds_nombre, tds_placement,
       plus_1000, serie_inferieure, saisie_abandon, saisie_forfait, volants, poules_inegales, sortie_poules, publication, fin_tardive,
       export_poona]


def main() -> int:
    for f in ALL:
        f()
    print(f"{len(ALL)} écrans écrits dans {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
