"""Что считать живой задачей — и почему одного определения мало не бывает.

Ради чего тест
--------------
Определений «задача ещё требует работы» в проекте было три и они не совпадали.
Эндпоинты фильтровали по `status == TaskStatus.open`, а фоновый цикл
`task_sla_notifier`, начисляя санкцию, сам переводил задачу в `overdue` — и она
исчезала с «Моего дня», из счётчиков карточки и из фильтра «просроченные
задачи» у МЗК. Получалось наоборот: чем дороже просрочка, тем меньше шансов её
увидеть. Задача с красной санкцией не показывалась вообще.

Второй дефект прятался за первым: `task_urgency` считал горящими задачи в
статусах `accepted` и `cancelled` — не было видно только потому, что фильтр
`== open` до него их не пускал. Поэтому правки идут парой и проверяются парой.

Тесты сознательно двух родов. Первые — про правило: набор статусов и сама
срочность, чистая логика без БД. Вторые сканируют исходники: в проекте нет
линтера на бэке, а забытое место — это ровно тот способ, которым дефект и
появился. Шесть мест починены, седьмое напишут завтра.
"""
import os
import re
import unittest
from datetime import date

from app.models.student_task import TaskStatus
from app.services.task_sla import SLA_TRACKED_STATUSES, is_sla_tracked
from app.services.task_urgency import NO_URGENCY_STATUSES, task_urgency

BACKEND = os.path.dirname(os.path.dirname(__file__))
SCANNED_DIRS = (
    os.path.join(BACKEND, "app", "api", "v1", "endpoints"),
    os.path.join(BACKEND, "app", "services"),
)
MIRROR_TS = os.path.join(
    os.path.dirname(BACKEND), "frontend", "src", "lib", "taskUrgency.ts"
)

TODAY = date(2026, 8, 31)
LONG_AGO = date(2026, 8, 1)  # 30 дней — заведомо critical, если срочность вообще есть


def _sources() -> list[tuple[str, str]]:
    out = []
    for directory in SCANNED_DIRS:
        for root, _, files in os.walk(directory):
            for name in sorted(files):
                if name.endswith(".py"):
                    path = os.path.join(root, name)
                    with open(path, encoding="utf-8") as handle:
                        out.append((os.path.relpath(path, BACKEND), handle.read()))
    return out


class StatusSetTests(unittest.TestCase):
    """Состав наборов пришпилен явно — это и есть договор с фронтом."""

    def test_live_set_matches_the_rule(self):
        # Набор обязан быть выводом is_sla_tracked, а не отдельным списком:
        # разойдись они, счётчики перестали бы совпадать с тем, за что штрафуют.
        self.assertEqual(
            SLA_TRACKED_STATUSES,
            frozenset(status for status in TaskStatus if is_sla_tracked(status)),
        )

    def test_live_set_is_pinned(self):
        # Явный список нужен, чтобы новый статус в TaskStatus не растворился в
        # наборе молча: пусть падает здесь, а не на экране ментора.
        self.assertEqual(
            {status.value for status in SLA_TRACKED_STATUSES},
            {"open", "in_progress", "submitted", "needs_revision", "overdue"},
        )

    def test_overdue_is_live(self):
        # Гвоздь всей правки: санкция уже начислена, значит задача тем более жива.
        self.assertIn(TaskStatus.overdue, SLA_TRACKED_STATUSES)
        self.assertIn(TaskStatus.in_progress, SLA_TRACKED_STATUSES)

    def test_sets_partition_all_statuses(self):
        # Каждый статус ровно в одном наборе: статус, выпавший из обоих, стал бы
        # задачей, которая нигде не считается и нигде не горит.
        live = {status.value for status in SLA_TRACKED_STATUSES}
        self.assertEqual(live | NO_URGENCY_STATUSES, {s.value for s in TaskStatus})
        self.assertEqual(live & NO_URGENCY_STATUSES, set())


class UrgencyByStatusTests(unittest.TestCase):
    """Границы дат покрыты в test_task_urgency; здесь — влияние статуса."""

    def test_terminal_task_never_burns(self):
        # Прежний DONE_STATUSES знал только "done": принятая и отменённая задачи
        # месячной давности считались critical.
        for status in ("done", "accepted", "cancelled"):
            with self.subTest(status=status):
                self.assertEqual(task_urgency(LONG_AGO, status, today=TODAY), "none")

    def test_paused_task_never_burns(self):
        # Ждёт подписи регламента — исполнитель заперт гейтом и работать не может.
        # task_sla часы ему не считает; красный цвет обещал бы обратное.
        for status in ("awaiting_signature", "blocked_by_agreement"):
            with self.subTest(status=status):
                self.assertEqual(task_urgency(LONG_AGO, status, today=TODAY), "none")

    def test_live_task_burns_in_every_live_status(self):
        # Обратная сторона: расширив фильтр, легко было бы погасить срочность
        # у самих просроченных.
        for status in SLA_TRACKED_STATUSES:
            with self.subTest(status=status.value):
                self.assertEqual(
                    task_urgency(LONG_AGO, status.value, today=TODAY), "critical"
                )

    def test_roadmap_statuses_are_untouched(self):
        # Той же функцией считается RoadmapTask со своим набором статусов.
        self.assertEqual(task_urgency(LONG_AGO, "planned", today=TODAY), "critical")
        self.assertEqual(task_urgency(LONG_AGO, "done", today=TODAY), "none")


class NoStaleFilterTests(unittest.TestCase):
    """Сканеры исходников: дефект был не в логике, а в шести копиях фильтра."""

    def test_no_open_only_filter_left(self):
        pattern = re.compile(r"StudentTask\.status\s*==\s*TaskStatus\.open")
        offenders = [
            path for path, source in _sources() if pattern.search(source)
        ]
        self.assertEqual(
            offenders,
            [],
            "Фильтр по одному status == open прячет просроченные и взятые в "
            "работу задачи. Нужен StudentTask.status.in_(SLA_TRACKED_STATUSES).",
        )

    def test_no_hardcoded_status_in_urgency_calls(self):
        # Ловушка, на которой правка легко остаётся половинчатой: запрос
        # расширили, а статус в вызов срочности так и уходит строкой "open" —
        # и срочность считается так, будто все задачи открыты.
        pattern = re.compile(r'task_urgency\([^)]*?,\s*"[a-z_]+"')
        offenders = [
            f"{path}: {match.group(0)}"
            for path, source in _sources()
            for match in pattern.finditer(source)
        ]
        self.assertEqual(offenders, [], "Статус задачи нужно передавать настоящий.")


class MirrorTests(unittest.TestCase):
    """frontend/src/lib/taskUrgency.ts объявлен зеркалом — проверяем, что это так."""

    def test_frontend_mirror_has_the_same_statuses(self):
        with open(MIRROR_TS, encoding="utf-8") as handle:
            source = handle.read()
        block = re.search(
            r"const NO_URGENCY_STATUSES = new Set\(\[(.*?)\]\)", source, re.S
        )
        self.assertIsNotNone(block, "В зеркале не найден NO_URGENCY_STATUSES")
        mirrored = set(re.findall(r"'([a-z_]+)'", block.group(1)))
        self.assertEqual(
            mirrored,
            NO_URGENCY_STATUSES,
            "Цвета на экране разойдутся с расчётом на бэке: обнови зеркало.",
        )


if __name__ == "__main__":
    unittest.main()
