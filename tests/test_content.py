"""Contrôles de cohérence de la banque de questions, des cas pratiques et des fiches."""
import json
import re
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_site  # noqa: E402

LEVELS = set(build_site.LEVELS)


def load(name):
    return json.loads((ROOT / "docs" / "data" / name).read_text(encoding="utf-8"))


class QuestionBankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load("questions.json")
        cls.questions = cls.data["questions"]
        cls.catalog = {d["id"] for d in build_site.load_catalog(build_site.ROOT / "docs")["docs"]}

    def test_volume(self):
        self.assertGreaterEqual(len(self.questions), 400, "la banque doit contenir plusieurs centaines de questions")
        exams = load("exams.json")
        self.assertEqual(set(exams), set(build_site.CATEGORIES), "un examen blanc par parcours (JA, arbitre)")
        for level in build_site.CATEGORIES:
            n = sum(level in q["levels"] for q in self.questions)
            self.assertGreaterEqual(n, exams[level]["sim"]["questions"] * 3,
                                    f"{level} : pas assez de questions pour varier les examens blancs")

    def test_answers_valid(self):
        for q in self.questions:
            with self.subTest(q=q["id"]):
                self.assertTrue(q["answer"])
                self.assertTrue(all(0 <= i < len(q["choices"]) for i in q["answer"]))
                self.assertLess(len(q["answer"]), len(q["choices"]))
                self.assertTrue(q["levels"])
                self.assertTrue(set(q["levels"]) <= set(build_site.CATEGORIES))
                self.assertTrue(set(q["grades"]) <= LEVELS)
                self.assertIn(q.get("phase", "avant"), build_site.PHASES)
                self.assertIn(q.get("ligue", "NAQ"), build_site.LIGUES)
                self.assertIn(q["theme"], build_site.THEMES)
                self.assertIn(q["ref"]["doc"], self.catalog)

    def test_categories(self):
        by_id = {q["id"]: q for q in self.questions}
        self.assertEqual(by_id["jdl-001"]["levels"], ["ALA"])          # juge de ligne : arbitre seulement
        reg = next(q for q in self.questions if q["theme"] == "regles")
        self.assertEqual(reg["levels"], ["JALA", "ALA"])                # règles du jeu : les deux parcours
        rgc = next(q for q in self.questions if q["theme"] == "rgc")
        self.assertEqual(rgc["levels"], ["JALA"])
        self.assertTrue(rgc["rgc"])
        self.assertEqual(build_site.rgc_phase("2.16"), "avant")
        self.assertEqual(build_site.rgc_phase("3.3.1.2"), "pendant")
        self.assertEqual(build_site.rgc_phase("2.23"), "apres")

    def test_no_choice_relies_on_position(self):
        # les propositions sont mélangées à l'affichage : pas de « toutes les réponses ci-dessus »
        bad = re.compile(r"(ci-dessus|ci-dessous|aucune des réponses|toutes les réponses)", re.I)
        for q in self.questions:
            for c in q["choices"]:
                self.assertIsNone(bad.search(c), f"{q['id']} : « {c} »")

    def test_answer_position_not_predictable(self):
        positions = Counter(i for q in self.questions if q["type"] == "single" for i in q["answer"])
        # l'ordre est mélangé à l'affichage, mais on évite qu'une position domine dans les sources
        self.assertLess(max(positions.values()) / sum(positions.values()), 0.95)

    def test_ids_unique(self):
        ids = [q["id"] for q in self.questions]
        self.assertEqual(len(ids), len(set(ids)))


class CasesAndFichesTests(unittest.TestCase):
    def test_cases(self):
        cases = load("cases.json")["cases"]
        self.assertGreaterEqual(len(cases), 20)
        catalog = {d["id"] for d in load("catalog.json")["docs"]}
        for c in cases:
            with self.subTest(case=c["id"]):
                self.assertTrue(c["context"])
                self.assertTrue(c["debrief"])
                self.assertTrue(c["steps"])
                for r in c["refs"]:
                    self.assertIn(r["doc"], catalog)

    def test_fiches(self):
        fiches = load("fiches.json")
        self.assertGreaterEqual(len(fiches), 10)
        catalog = {d["id"] for d in load("catalog.json")["docs"]}
        for f in fiches:
            for r in f["refs"]:
                self.assertIn(r["doc"], catalog, f"fiche {f['id']}")

    def test_exams_config(self):
        exams = load("exams.json")
        self.assertEqual(set(exams), set(build_site.CATEGORIES))
        self.assertEqual(exams["JALA"]["sim"]["passPct"], 80)
        for level, cfg in exams.items():
            self.assertTrue(set(cfg["sim"]["themes"]) <= set(build_site.THEMES), level)


class ParserTests(unittest.TestCase):
    def test_parse_question_file(self):
        import tempfile
        text = """@theme rgc
@doc 03.01
Q t-1 | D: 2 | R: 03.01 2.16
Énoncé
sur deux lignes
- faux
+ juste
> Explication.
L: JALC JAFA
"""
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
            fh.write(text)
        qs = build_site.parse_questions(Path(fh.name))
        Path(fh.name).unlink()
        self.assertEqual(len(qs), 1)
        q = qs[0]
        self.assertEqual(q["q"], "Énoncé sur deux lignes")
        self.assertEqual(q["answer"], [1])
        self.assertEqual(q["levels"], ["JALC", "JAFA"])
        self.assertEqual(q["ref"], {"doc": "03.01", "art": "2.16"})
        self.assertEqual(q["difficulty"], 2)


if __name__ == "__main__":
    unittest.main()
