"""Чистая логика — порядок избранных вузов.

Приоритет nullable намеренно: «не расставлен» должно отличаться от «первый».
Значит сортировка обязана класть NULL в конец, а не считать их нулём.
"""
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.api.v1.endpoints.student_universities import _sort_key

T0 = datetime(2026, 8, 1, tzinfo=timezone.utc)


def item(priority, minutes=0):
    return SimpleNamespace(priority=priority, created_at=T0 + timedelta(minutes=minutes))


class ShortlistSortTests(unittest.TestCase):
    def test_nulls_go_last(self):
        items = [item(None, 0), item(2, 1), item(1, 2)]
        self.assertEqual([i.priority for i in sorted(items, key=_sort_key)], [1, 2, None])

    def test_unprioritised_keep_insertion_order(self):
        items = [item(None, 5), item(None, 1), item(None, 3)]
        self.assertEqual([i.created_at for i in sorted(items, key=_sort_key)],
                         [T0 + timedelta(minutes=1), T0 + timedelta(minutes=3), T0 + timedelta(minutes=5)])

    def test_priority_zero_is_not_treated_as_missing(self):
        items = [item(None, 0), item(0, 1)]
        self.assertEqual([i.priority for i in sorted(items, key=_sort_key)], [0, None])

    def test_ties_broken_by_created_at(self):
        items = [item(1, 9), item(1, 2)]
        self.assertEqual([i.created_at for i in sorted(items, key=_sort_key)],
                         [T0 + timedelta(minutes=2), T0 + timedelta(minutes=9)])


if __name__ == "__main__":
    unittest.main()
