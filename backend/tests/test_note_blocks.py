from __future__ import annotations

import unittest

from app.services.note_blocks import block_headings, filter_visible, split_blocks

SAMPLE = """Вступительный текст.

## Итог
Обсудили выбор страны.

## Договорённости
- Собрать документы

## Материалы
Ссылка на гайд
"""


class NoteBlocksTests(unittest.TestCase):
    def test_split_keeps_intro_and_sections(self) -> None:
        blocks = split_blocks(SAMPLE)
        headings = [b["heading"] for b in blocks]
        self.assertEqual(headings, ["", "Итог", "Договорённости", "Материалы"])

    def test_block_headings_excludes_intro(self) -> None:
        keys = [b["key"] for b in block_headings(SAMPLE)]
        self.assertEqual(keys, ["Итог", "Договорённости", "Материалы"])

    def test_filter_hides_selected_block_only(self) -> None:
        visible = filter_visible(SAMPLE, ["Договорённости"])
        self.assertIn("Итог", visible)
        self.assertIn("Материалы", visible)
        self.assertNotIn("Договорённости", visible)
        self.assertNotIn("Собрать документы", visible)
        self.assertIn("Вступительный текст", visible)

    def test_filter_with_nothing_hidden_keeps_all_sections(self) -> None:
        visible = filter_visible(SAMPLE, [])
        for heading in ("Итог", "Договорённости", "Материалы"):
            self.assertIn(heading, visible)

    def test_empty_input_is_safe(self) -> None:
        self.assertEqual(split_blocks(None), [])
        self.assertEqual(filter_visible(None, ["x"]), "")
        self.assertEqual(block_headings(""), [])


if __name__ == "__main__":
    unittest.main()
