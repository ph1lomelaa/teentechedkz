"""Чистая логика, без БД/сети — парсер HTML-описаний вузов из Tilda.

Фикстуры взяты дословно из живого ответа store.tildaapi.pro, включая реальные
краевые случаи: опечатка в подписи («бакалавиарта») и продукт, где требования
свёрстаны через <br /> без единого <ul>.
"""
import unittest

from app.services.tilda_text_parser import (
    DEGREE_BACHELOR,
    DEGREE_GENERAL,
    parse_tilda_text,
)

# Обычный, хорошо размеченный продукт: город + <ul> факультеты + требования + дедлайн.
VICTORIA = (
    "<strong>Город: </strong>Мельбурн<br /><strong>Факультеты:</strong><br />"
    "<ul><li>Бизнес</li><li>Образование</li><li>Инженерия и компьютерные науки</li>"
    "<li>изобразительное искусство</li></ul>"
    "<strong>Требования:</strong><br /><ul><li>заверенные копии академических справок</li>"
    "<li>заполненные формы для повышения квалификации</li></ul>"
    "<strong>Дедлайны:</strong> <br /><ul><li>Февраль-июнь 2024 года</li></ul>"
)

# Требования свёрстаны нумерованным текстом через <br />, без <ul>.
KYUNGPOOK = (
    "<strong>Город: </strong>Тэгу<br /><strong>Требования:</strong><br />"
    "1. Один экземпляр формы заявки<br />2. Мотивационное письмо<br />"
    "<strong>Дедлайн:</strong><br />Май 12 2022 18:00 (осенний семестр)"
)

# Реальная опечатка в подписи: «Требования для бакалавиарта».
PAVIA_TYPO = (
    "<strong>Город: </strong>Павия<br /><strong>Факультеты:</strong><br />"
    "<ul><li>Экономика и финансы</li><li>Медицина и психология</li></ul>"
    "<strong>Требования для бакалавиарта:</strong><br />"
    "<ul><li>Биографические данные (резюме) на английском языке;</li></ul>"
)


class TildaTextParserTests(unittest.TestCase):
    def test_parses_city_faculties_requirements_and_deadline(self):
        parsed = parse_tilda_text(VICTORIA)
        self.assertEqual(parsed.city, "Мельбурн")
        self.assertEqual(
            parsed.faculties,
            ["Бизнес", "Образование", "Инженерия и компьютерные науки", "изобразительное искусство"],
        )
        self.assertIn(DEGREE_GENERAL, parsed.requirements)
        self.assertEqual(len(parsed.requirements[DEGREE_GENERAL]), 2)
        self.assertIn("академических справок", parsed.requirements[DEGREE_GENERAL][0])
        self.assertIn("Февраль-июнь 2024", parsed.deadline_note)

    def test_extracts_year_from_deadline_prose(self):
        """Дедлайны часто устаревшие — год нужен, чтобы пометить их в UI."""
        self.assertEqual(parse_tilda_text(VICTORIA).deadline_year_mentioned, 2024)
        self.assertEqual(parse_tilda_text(KYUNGPOOK).deadline_year_mentioned, 2022)

    def test_handles_requirements_without_list_markup(self):
        """Нумерованный текст через <br /> тоже должен стать списком пунктов."""
        parsed = parse_tilda_text(KYUNGPOOK)
        self.assertEqual(parsed.city, "Тэгу")
        self.assertEqual(parsed.faculties, [])
        items = parsed.requirements[DEGREE_GENERAL]
        self.assertEqual(len(items), 2)
        # Ведущая нумерация "1." / "2." снимается.
        self.assertEqual(items[0], "Один экземпляр формы заявки")
        self.assertEqual(items[1], "Мотивационное письмо")

    def test_misspelled_degree_label_still_buckets_as_bachelor(self):
        """«бакалавиарта» — реальная опечатка в источнике; префикс «бакалав» её ловит."""
        parsed = parse_tilda_text(PAVIA_TYPO)
        self.assertIn(DEGREE_BACHELOR, parsed.requirements)
        self.assertIn("Биографические данные", " ".join(parsed.requirements[DEGREE_BACHELOR]))

    def test_degree_specific_labels_bucket_separately(self):
        html = (
            "<strong>Требования для бакалавриата:</strong><ul><li>аттестат</li></ul>"
            "<strong>Требования для магистратуры:</strong><ul><li>диплом бакалавра</li></ul>"
            "<strong>Требования для докторантуры:</strong><ul><li>диплом магистра</li></ul>"
        )
        parsed = parse_tilda_text(html)
        self.assertEqual(parsed.requirements["bachelor"], ["аттестат"])
        self.assertEqual(parsed.requirements["master"], ["диплом бакалавра"])
        self.assertEqual(parsed.requirements["doctorate"], ["диплом магистра"])

    def test_unknown_labels_are_reported_not_dropped(self):
        parsed = parse_tilda_text("<strong>Что получают стипендиаты:</strong> проживание")
        self.assertIn("Что получают стипендиаты", parsed.unclassified_labels)

    def test_empty_and_malformed_input_never_raises(self):
        for bad in ["", "   ", None, "просто текст без разметки", "<strong></strong>", "<ul><li>x"]:
            parsed = parse_tilda_text(bad)  # type: ignore[arg-type]
            self.assertEqual(parsed.city, "")
            self.assertEqual(parsed.faculties, [])

    def test_html_entities_are_unescaped(self):
        parsed = parse_tilda_text("<strong>Город: </strong>Сан-Паулу &amp; окрестности")
        self.assertIn("&", parsed.city)
        self.assertNotIn("&amp;", parsed.city)

    def test_nbsp_does_not_leak_into_text(self):
        """&nbsp; в исходнике не должен доезжать до UI ни как сущность, ни как \\xa0."""
        parsed = parse_tilda_text(
            "<strong>Требования:</strong><ul><li>Одно из&nbsp;старейших заведений</li></ul>"
        )
        item = parsed.requirements[DEGREE_GENERAL][0]
        self.assertNotIn("&nbsp;", item)
        self.assertNotIn("\xa0", item)
        self.assertEqual(item, "Одно из старейших заведений")


if __name__ == "__main__":
    unittest.main()
