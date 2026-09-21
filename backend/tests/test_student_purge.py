"""План полного удаления студента: что удаляется, а что только отвязывается.

Исполнение плана требует базы (фикстур с БД в проекте нет), поэтому
проверяется сам план — именно в нём ошибка молча снесла бы чужие данные
или оставила бы FK, на котором удаление упадёт.
"""
import unittest

from app.models.student import Student
from app.services.student_purge import build_purge_plan


def _flatten(plan, parent="students"):
    for step in plan:
        yield parent, step
        yield from _flatten(step.children, step.table)


class PurgePlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plan = build_purge_plan(Student.__table__)
        self.by_key = {(s.table, s.column): s for _, s in _flatten(self.plan)}

    def test_owned_data_is_deleted(self) -> None:
        for key in [
            ("contracts", "student_id"),
            ("payments", "contract_id"),
            ("applications", "student_id"),
            ("mentor_assignments", "student_id"),
            ("documents", "student_id"),
            ("roadmaps", "student_id"),
        ]:
            with self.subTest(key=key):
                self.assertEqual(self.by_key[key].action, "delete")

    def test_shared_records_are_only_unlinked(self) -> None:
        # Заметки, чаты, снимки Notion переживают студента — в моделях SET NULL.
        for key in [
            ("student_notes", "student_id"),
            ("telegram_chat_sessions", "student_id"),
            ("notion_snapshots", "student_id"),
            ("access_requests", "suggested_student_id"),
        ]:
            with self.subTest(key=key):
                self.assertEqual(self.by_key[key].action, "set_null")

    def test_fk_without_rule_is_covered(self) -> None:
        # sync_status.student_id объявлен без ondelete — голый DELETE упал бы.
        self.assertEqual(self.by_key[("sync_status", "student_id")].action, "set_null")

    def test_unlinked_tables_are_not_descended(self) -> None:
        for _, step in _flatten(self.plan):
            if step.action == "set_null":
                self.assertEqual(step.children, ())

    def test_portal_users_are_not_in_plan(self) -> None:
        self.assertNotIn("users", {s.table for _, s in _flatten(self.plan)})


if __name__ == "__main__":
    unittest.main()
