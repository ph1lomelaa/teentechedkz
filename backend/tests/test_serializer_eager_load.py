"""Контракт eager-load для сериализаторов карточки студента.

Ради чего тест: `_student_to_dict` обходит девять relationship'ов объекта
Student. В async-сессии незагруженная связь не подгружается лениво, а падает с
MissingGreenlet — то есть 500-й. Список нужных связей дублировался в четырёх
вызывающих местах, и в `GET /export/students/{id}` он разъехался: там грузились
только applications, services и contracts, поэтому выгрузка карточки студента
падала на первом же обращении к portfolio_progress.

Теперь список один — `student_card_loaders()`. Тест сверяет его с тем, что
сериализатор реально трогает, поэтому новая связь в `_student_to_dict` без
добавления в загрузчик роняет CI, а не прод.

БД не нужна: разбираем исходник и метаданные модели.
"""
import inspect
import re
import unittest

from sqlalchemy import inspect as sa_inspect

from app.api.v1.endpoints.students import _student_to_dict, student_card_loaders
from app.models.student import Student


def _relationship_names() -> set[str]:
    return {rel.key for rel in sa_inspect(Student).relationships}


def _touched_by_serializer() -> set[str]:
    """Связи, к которым обращается тело `_student_to_dict` (через `s.<attr>`)."""
    source = inspect.getsource(_student_to_dict)
    return set(re.findall(r"\bs\.(\w+)", source)) & _relationship_names()


def _covered_by_loaders() -> set[str]:
    """Имена связей верхнего уровня, перечисленных в `student_card_loaders()`.

    У Load-объекта путь — чередование (Mapper, relationship, Mapper, ...);
    имена берём из элементов пути, совпавших со связями самой модели Student.
    """
    known = _relationship_names()
    covered = set()
    for opt in student_card_loaders():
        for element in opt.path:
            key = getattr(element, "key", None)
            if key in known:
                covered.add(key)
    return covered


class StudentCardLoadersTests(unittest.TestCase):
    def test_loaders_cover_everything_serializer_touches(self) -> None:
        missing = _touched_by_serializer() - _covered_by_loaders()
        self.assertEqual(
            missing,
            set(),
            f"_student_to_dict читает связи {sorted(missing)}, которых нет в "
            "student_card_loaders() — в async это MissingGreenlet, то есть 500.",
        )

    def test_loaders_have_no_dead_entries(self) -> None:
        # Обратная сторона: лишний selectinload — это лишний SQL-запрос на
        # каждую карточку. Список должен совпадать, а не просто покрывать.
        extra = _covered_by_loaders() - _touched_by_serializer()
        self.assertEqual(
            extra,
            set(),
            f"student_card_loaders() грузит {sorted(extra)}, но сериализатор их "
            "не читает — лишние запросы на каждой карточке студента.",
        )

    def test_serializer_touches_something_at_all(self) -> None:
        # Страховка от того, что регулярка перестанет что-либо находить и оба
        # теста выше начнут проходить на пустых множествах.
        self.assertGreaterEqual(len(_touched_by_serializer()), 5)
