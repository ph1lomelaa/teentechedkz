"""Чистая логика подбора вуза для заявки по свободному тексту.

Контекст: `applications.university` — строка, а страна в тех же заявках
записана как попало («сеул», «китай. гонконг», «south korea»). Поэтому
совпадение по стране здесь — бонус, а не фильтр: жёсткий фильтр отбросил бы
корректные совпадения.
"""
import unittest
import uuid
from types import SimpleNamespace

from app.services.application_backfill import (
    COUNTRY_BONUS,
    MATCH_THRESHOLD,
    _countries_agree,
    best_match,
)


def uni(name, country="Германия"):
    return SimpleNamespace(id=uuid.uuid4(), name=name, country_name=country)


CATALOG = [
    uni("Technische Universitaet Berlin", "Германия"),
    uni("Technische Universitaet Muenchen", "Германия"),
    uni("Albert-Ludwigs-Universitaet Freiburg", "Германия"),
    uni("Korea Advanced Institute of Science and Technology (KAIST)", "Корея"),
    uni("Universita di Bologna", "Италия"),
]


class CountryAgreementTests(unittest.TestCase):
    def test_exact(self):
        self.assertTrue(_countries_agree("Германия", "Германия"))

    def test_case_and_spacing(self):
        self.assertTrue(_countries_agree("  германия ", "Германия"))

    def test_substring_both_directions(self):
        """Реальные данные: «китай. гонконг» и «республика корея»."""
        self.assertTrue(_countries_agree("китай. гонконг", "Китай"))
        self.assertTrue(_countries_agree("Корея", "республика корея"))

    def test_unrelated(self):
        self.assertFalse(_countries_agree("Италия", "Германия"))

    def test_missing_side(self):
        self.assertFalse(_countries_agree(None, "Германия"))
        self.assertFalse(_countries_agree("Италия", None))


class BestMatchTests(unittest.TestCase):
    def test_exact_name_matches(self):
        best, score, country_ok = best_match("Universita di Bologna", "Италия", CATALOG)
        self.assertEqual(best.name, "Universita di Bologna")
        self.assertGreaterEqual(score, MATCH_THRESHOLD)
        self.assertTrue(country_ok)

    def test_acronym_shortcut(self):
        """_similarity умеет «KAIST» == «... (KAIST)» — проверяем, что не сломали."""
        best, score, _ = best_match("KAIST", "Корея", CATALOG)
        self.assertIn("KAIST", best.name)
        self.assertGreaterEqual(score, MATCH_THRESHOLD)

    def test_similar_universities_are_not_confused(self):
        """Berlin и München отличаются одним токеном — регрессия импорта."""
        best, score, _ = best_match("Technische Universitaet Berlin", "Германия", CATALOG)
        self.assertEqual(best.name, "Technische Universitaet Berlin")
        self.assertGreaterEqual(score, MATCH_THRESHOLD)

    def test_wrong_country_still_matches_on_a_strong_name(self):
        """Страна в заявке бывает городом — она не должна отбрасывать вуз."""
        best, score, country_ok = best_match("Universita di Bologna", "Болонья", CATALOG)
        self.assertEqual(best.name, "Universita di Bologna")
        self.assertFalse(country_ok)
        self.assertGreaterEqual(score, MATCH_THRESHOLD)

    def test_country_match_adds_bonus(self):
        # Название заведомо неточное, иначе балл упирается в 1.0 и бонус
        # клампится — на точном совпадении разницы не увидеть.
        _, with_country, _ = best_match("Universitaet Freiburg im Breisgau", "Германия", CATALOG)
        _, without_country, _ = best_match("Universitaet Freiburg im Breisgau", "Марс", CATALOG)
        self.assertAlmostEqual(with_country - without_country, COUNTRY_BONUS, places=3)

    def test_bonus_never_exceeds_one(self):
        """Точное совпадение уже даёт 1.0 — бонус не должен вытолкнуть выше."""
        _, score, _ = best_match("Universita di Bologna", "Италия", CATALOG)
        self.assertLessEqual(score, 1.0)

    def test_garbage_scores_low(self):
        _, score, _ = best_match("абырвалг", "Марс", CATALOG)
        self.assertLess(score, MATCH_THRESHOLD)

    def test_empty_name_returns_nothing(self):
        for raw in ("", "   ", None):
            with self.subTest(raw=raw):
                best, score, _ = best_match(raw, "Германия", CATALOG)
                self.assertIsNone(best)
                self.assertEqual(score, 0.0)

    def test_empty_catalog(self):
        best, score, _ = best_match("Universita di Bologna", "Италия", [])
        self.assertIsNone(best)
        self.assertEqual(score, 0.0)


if __name__ == "__main__":
    unittest.main()
