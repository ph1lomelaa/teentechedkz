"""Полное удаление карточки студента — вместе со всем, что на неё ссылается.

Зачем
-----
Из импортов (Notion, Excel, Telegram) в базу попадают мусорные карточки, а
`DELETE /students/{id}` их только архивирует. Архив нигде в интерфейсе не
виден, поэтому мусор оставалось вычищать руками в psql.

Почему обход графа в коде, а не каскад БД
-----------------------------------------
Базовые таблицы создавались `Base.metadata.create_all` в разное время
(bootstrap_db.py), и то, какие `ON DELETE` стоят в живой базе, зависит от того,
какими были модели в момент создания. У `sync_status.student_id` правила нет
вовсе — голый `DELETE FROM students` упал бы на первом же студенте с записью
синка. Поэтому правило берём из моделей и исполняем сами: где в модели
CASCADE — удаляем дочерние строки (рекурсивно), где SET NULL — обнуляем
ссылку. FK без правила: nullable — обнуляем, иначе удаляем.

План обхода (`build_purge_plan`) — чистая функция над metadata: проверяется
юнит-тестом без базы, фикстур с БД в проекте нет.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import ColumnElement, Table, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401 — регистрирует все таблицы в metadata
from app.core.database import Base
from app.models.document import Document
from app.models.student import Student
from app.models.user import User, UserRole
from app.services.minio_service import minio_delete

logger = logging.getLogger(__name__)

# Граф от students — дерево глубиной 5 (roadmaps → ... → questionnaire_responses).
# Предел нужен на случай, если в моделях появится цикл: лучше громко упасть,
# чем уйти в бесконечную рекурсию.
MAX_DEPTH = 8


@dataclass(frozen=True)
class PurgeStep:
    """Одна зависимая таблица: как её обработать и что делать с её детьми."""

    table: str
    column: str
    #: колонка родителя, на которую смотрит FK (обычно id)
    referenced_column: str
    action: Literal["delete", "set_null"]
    children: tuple["PurgeStep", ...] = field(default=())


def _action_for(fk) -> Literal["delete", "set_null"]:
    rule = (fk.ondelete or "").upper()
    if rule == "CASCADE":
        return "delete"
    if rule == "SET NULL":
        return "set_null"
    # Правила нет (или RESTRICT): необязательную ссылку обнуляем, чтобы не
    # терять чужую строку; обязательную обнулить нельзя — удаляем.
    return "set_null" if fk.parent.nullable else "delete"


def build_purge_plan(table: Table, _depth: int = 0) -> tuple[PurgeStep, ...]:
    if _depth > MAX_DEPTH:
        raise RuntimeError(f"Слишком глубокий граф зависимостей у {table.name} — цикл в моделях?")
    steps = []
    for child in Base.metadata.sorted_tables:
        for fk in child.foreign_keys:
            if fk.column.table is not table:
                continue
            action = _action_for(fk)
            if child is table and action == "delete":
                raise RuntimeError(f"Самоссылка {child.name}.{fk.parent.name} с удалением не поддерживается")
            steps.append(
                PurgeStep(
                    table=child.name,
                    column=fk.parent.name,
                    referenced_column=fk.column.name,
                    action=action,
                    children=build_purge_plan(child, _depth + 1) if action == "delete" else (),
                )
            )
    return tuple(steps)


async def _execute(
    db: AsyncSession, parent: Table, parent_where: ColumnElement[bool], plan: tuple[PurgeStep, ...]
) -> None:
    tables = Base.metadata.tables
    for step in plan:
        child = tables[step.table]
        cond = child.c[step.column].in_(
            select(parent.c[step.referenced_column]).where(parent_where)
        )
        if step.action == "set_null":
            await db.execute(update(child).where(cond).values({step.column: None}))
        else:
            # Сначала внуки: пока строки ребёнка на месте, подзапрос их видит.
            await _execute(db, child, cond, step.children)
            await db.execute(delete(child).where(cond))


async def purge_student(db: AsyncSession, student: Student) -> None:
    """Удалить студента и всё зависимое. Коммит — на вызывающем.

    Файлы документов удаляются из хранилища только после коммита — это делает
    вызывающий по списку из `document_storage_paths`, иначе откат транзакции
    оставил бы строки без файлов.
    """
    students = Student.__table__
    where = students.c.id == student.id

    # Портальный аккаунт не удаляем: за users тянутся сообщения, подписи
    # регламентов, инциденты (RESTRICT). Закрываем вход — этого достаточно,
    # а аккаунт остаётся восстановимым.
    if student.user_id:
        portal = await db.get(User, student.user_id)
        if portal is not None and portal.role == UserRole.student:
            portal.is_active = False

    await _execute(db, students, where, build_purge_plan(students))
    await db.execute(delete(students).where(where))


async def document_storage_paths(db: AsyncSession, student_id: uuid.UUID) -> list[str]:
    rows = await db.execute(
        select(Document.storage_path).where(Document.student_id == student_id)
    )
    return [p for p in rows.scalars().all() if p]


async def delete_stored_files(paths: list[str]) -> None:
    for path in paths:
        try:
            await minio_delete(path)
        except Exception:
            logger.exception("Не удалось удалить файл документа из хранилища: %s", path)
