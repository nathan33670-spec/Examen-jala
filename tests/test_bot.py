"""Tests unitaires du bot de mise à jour des règlements (sans réseau)."""
import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bot"))

import update_regulations as bot  # noqa: E402


class SeasonTests(unittest.TestCase):
    def test_season_starts_in_september(self):
        self.assertEqual(bot.season_for(dt.date(2026, 9, 1)), "2026-2027")
        self.assertEqual(bot.season_for(dt.date(2026, 8, 31)), "2025-2026")
        self.assertEqual(bot.season_for(dt.date(2027, 1, 15)), "2026-2027")

    def test_pick_current_season(self):
        seasons = ["2026-2027", "2027-2028"]
        self.assertEqual(bot.pick_current_season(seasons, dt.date(2026, 10, 15)), "2026-2027")
        # en juillet, la saison suivante est publiée mais la saison en cours reste la référence
        self.assertEqual(bot.pick_current_season(["2025-2026", "2026-2027"], dt.date(2026, 7, 1)), "2025-2026")
        # saison en cours absente de l'API : la plus récente antérieure, sinon la première
        self.assertEqual(bot.pick_current_season(["2027-2028"], dt.date(2026, 10, 1)), "2027-2028")


class NamingTests(unittest.TestCase):
    def test_doc_id(self):
        self.assertEqual(bot.doc_id_from_filename("GUI03.01_VS_ReglementGeneralCompetitions.pdf"), "03.01")
        self.assertEqual(bot.doc_id_from_filename("GUI03.01A07_VS_Duree_match.pdf"), "03.01.A07")
        self.assertEqual(bot.doc_id_from_filename("GUI07.04F01_VS_Notification.pdf"), "07.04.F01")
        self.assertEqual(bot.doc_id_from_filename("GUI02.04A1_ADM_Tableau.pdf"), "02.04.A01")
        self.assertIsNone(bot.doc_id_from_filename("Regles.pdf"))

    def test_clean_title(self):
        self.assertEqual(bot.clean_title("03.01.A07 Durées moyennes indicatives des matches"),
                         "Durées moyennes indicatives des matches")
        self.assertEqual(bot.clean_title("06.02 Contenus des formations et examens"),
                         "Contenus des formations et examens")

    def test_matches(self):
        cfg = {"include": ["GUI03.01*", "GUI07.0[1-9]_*"], "exclude": ["GUI03.01A13*"]}
        self.assertTrue(bot.matches("GUI03.01A07_VS_Duree_match.pdf", cfg))
        self.assertTrue(bot.matches("GUI07.04_VS_ReglementCartons.pdf", cfg))
        self.assertFalse(bot.matches("GUI07.04F01_VS_Form.pdf", cfg))
        self.assertFalse(bot.matches("GUI03.01A13_VS_Logiciels.pdf", cfg))
        self.assertTrue(bot.matches("GUI99.99_X.pdf", {"all": True}))


SAMPLE = """  Règlement
  adoption : COMEX du 30 mai 2026
  Règlement général        entrée en vigueur : 1er septembre 2026
  remplace : Chapitre 03.01-2025/1
  5 grammes de plumes, des tonnes d’émotion
1. INTRODUCTION
  1.1. Étendue du règlement
  Le présent règlement s’applique à toutes les compétitions se déroulant sous
  l’autorité de la Fédération.
  – compétitions fédérales ;
  – tournois ;
  2.16. Horaires des matchs et temps de repos
  Sauf décision exceptionnelle du juge-arbitre, aucun match ne doit débuter avant 8 h 00, ni après
  23 h 00.
FFBaD / GdB / édition – 2026/1 Chapitre 03.01. Les principes sportifs  page 1
\f  2.2.3. Les pointes des plumes doivent se situer sur un cercle compris entre 58 mm et
  68 mm.
"""


class StructureTests(unittest.TestCase):
    def setUp(self):
        self.meta, self.blocks = bot.structure_text(SAMPLE, "Règlement général des compétitions")

    def test_meta(self):
        self.assertEqual(self.meta["adoption"], "COMEX du 30 mai 2026")
        self.assertEqual(self.meta["effective"], "1er septembre 2026")
        self.assertEqual(self.meta["replaces"], "Chapitre 03.01-2025/1")
        self.assertEqual(self.meta["edition"], "2026/1")

    def test_blocks(self):
        types = [b[0] for b in self.blocks]
        texts = [b[1] for b in self.blocks]
        self.assertIn(["h2", "1. INTRODUCTION"], self.blocks)
        self.assertIn("h3", types)
        self.assertIn("Le présent règlement s’applique à toutes les compétitions se déroulant sous l’autorité de la Fédération.", texts)
        self.assertIn(["li", "tournois ;"], self.blocks)
        self.assertFalse(any("FFBaD / GdB" in t for t in texts), "pied de page non supprimé")
        self.assertFalse(any("grammes de plumes" in t for t in texts), "cartouche non supprimé")
        # « 68 mm. » ne doit pas être pris pour un article numéroté
        self.assertTrue(any(t.endswith("entre 58 mm et 68 mm.") for t in texts))


class ImpactTests(unittest.TestCase):
    def test_impacted_questions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "questions.json"
            path.write_text(json.dumps({"questions": [
                {"id": "a", "q": "x", "ref": {"doc": "03.01", "art": "2.16"}},
                {"id": "b", "q": "y", "ref": {"doc": "03.01.A07", "art": ""}},
                {"id": "c", "q": "z", "ref": {"doc": "07.04", "art": "3"}},
            ]}), encoding="utf-8")
            ids = [q["id"] for q in bot.impacted_questions(path, {"03.01"})]
            self.assertEqual(ids, ["a", "b"])


class OfflineSyncTests(unittest.TestCase):
    """Synchronisation complète avec une fausse API et des PDF locaux."""

    def test_sync_and_change_detection(self):
        pdf_src = ROOT / "docs" / "reglements" / "pdf" / "GUI07.04_VS_ReglementCartons.pdf"
        if not pdf_src.exists():
            self.skipTest("PDF de référence absent")
        tree = {"folders": [{"name": "07 Disciplinaire", "files": [
            {"name": "07.04 Procédure de gestion des cartons", "filename": pdf_src.name,
             "url": f"/files/2026-2027/GDB-07/{pdf_src.name}"}]}]}
        cfg = {"api": "https://example.invalid", "include": ["GUI07.04*"], "extra": [], "upcoming_seasons": False}
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "site"
            orig_get_json = bot.get_json
            bot.get_json = lambda url: ["2026-2027"] if url.endswith("/seasons") else tree
            try:
                sync = bot.Sync(site, cfg, dt.date(2026, 10, 15), offline_dir=pdf_src.parent)
                sync.run()
                self.assertTrue(sync.write())
                cat = json.loads((site / "data" / "catalog.json").read_text(encoding="utf-8"))
                self.assertEqual(cat["docs"][0]["id"], "07.04")
                self.assertTrue((site / cat["docs"][0]["text"]).exists())
                updates = json.loads((site / "data" / "updates.json").read_text(encoding="utf-8"))
                self.assertIn("Import initial", updates[0]["note"])
                # second passage : rien n'a changé
                sync2 = bot.Sync(site, cfg, dt.date(2026, 10, 16), offline_dir=pdf_src.parent)
                sync2.run()
                self.assertFalse(sync2.write())
                self.assertEqual(sync2.changes, [])
            finally:
                bot.get_json = orig_get_json


if __name__ == "__main__":
    unittest.main()
