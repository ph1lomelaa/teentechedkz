"""Подписи регламентов в таймлайне студента (хвост плана ОС, п.9).

Ради чего тест
--------------
Таймлайн уже агрегировал документы, задачи, встречи, телеграм, конспекты и
жалобы — не подписи. Правка регламента студентом («блок C» ОС 30/07) —
юридически значимое событие, и его не было видно там же, где всё остальное:
чтобы узнать, подписал ли студент актуальную редакцию, приходилось идти в
отдельный раздел «Регламенты» и искать его в списке подписей вручную.

Подпись привязана к пользователю (AgreementSignature.user_id), а не к
студенту напрямую — у ментора, МЗК и админа тоже есть свои регламенты, и их
подписи никакого отношения к карточке студента не имеют. Оба теста ниже
проверяют границу: подпись студента становится событием таймлайна, подпись
кого угодно другого — не имеет смысла здесь и в тест не проверяется (она до
этой функции просто не доезжает: эндпоинт фильтрует запрос по
student.user_id ещё в SQL).

Функция чистая — тот же приём, что в task_sla.py/task_urgency.py: форматирование
проверяется без БД, поход за данными не тестируется юнитом.
"""
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.endpoints.students import _agreement_signature_timeline_items


def _signature(**overrides):
    defaults = dict(
        id=uuid.uuid4(),
        agreement_id=uuid.uuid4(),
        signed_at=datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        agreement_version=2,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class AgreementSignatureTimelineTests(unittest.TestCase):
    def test_signature_becomes_a_regulation_event(self):
        signature = _signature()
        items = _agreement_signature_timeline_items([(signature, "Регламент менторов")])

        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["kind"], "Регламент")
        self.assertEqual(item["title"], "Регламент менторов")
        self.assertIn("2", item["text"])
        self.assertEqual(item["at"], "2026-08-20T10:00:00+00:00")

    def test_item_id_and_meta_reference_the_real_records(self):
        # href общий — списка подписаний по одному регламенту в CRM нет,
        # как и у жалоб (href="/workspace/complaints") в этом же файле.
        signature = _signature()
        item = _agreement_signature_timeline_items([(signature, "Регламент студента")])[0]

        self.assertEqual(item["id"], f"agreement-signature:{signature.id}")
        self.assertEqual(item["meta"]["signature_id"], str(signature.id))
        self.assertEqual(item["meta"]["agreement_id"], str(signature.agreement_id))
        self.assertEqual(item["href"], "/agreements")

    def test_empty_rows_produce_no_events(self):
        # Студент без портального аккаунта или ничего не подписавший — самый
        # частый случай, и функция обязана тихо вернуть пустой список, а не
        # упасть на распаковке.
        self.assertEqual(_agreement_signature_timeline_items([]), [])

    def test_multiple_signatures_keep_their_own_version(self):
        # Регламент переиздают, студент подписывает заново — обе подписи
        # должны остаться разными событиями с верными номерами версий.
        first = _signature(agreement_version=1, signed_at=datetime(2026, 1, 10, tzinfo=timezone.utc))
        second = _signature(agreement_version=2, signed_at=datetime(2026, 8, 20, tzinfo=timezone.utc))
        items = _agreement_signature_timeline_items([
            (second, "Регламент студента"),
            (first, "Регламент студента"),
        ])

        self.assertEqual([i["text"] for i in items], ["Подписан, версия 2", "Подписан, версия 1"])


if __name__ == "__main__":
    unittest.main()
