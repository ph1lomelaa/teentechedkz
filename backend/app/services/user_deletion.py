"""Что в системе держит аккаунт и мешает удалить его насовсем.

Удаление сотрудника и деактивация — разные вещи, и раньше они были одной:
`DELETE /users/{id}` назывался удалением, а только снимал `is_active`. Из-за
этого мусорные аккаунты («test», ошибочные приглашения) оставались в базе
навсегда, а в списках выбора их приходилось терпеть.

Физически удалять кого попало нельзя. На `users.id` около восьмидесяти внешних
ключей. Часть без `ondelete` — там `DELETE` просто упадёт ошибкой БД. Часть с
`ondelete="CASCADE"` — и вот это опаснее: удаление молча унесло бы чекины,
оценки ОКК МЗК, штрафы, вознаграждения, жалобы и переписку, то есть историю по
деньгам и регламентам, которую никто не просил стирать.

Поэтому удаление разрешаем ровно тогда, когда стирать нечего, а во всех
остальных случаях объясняем, что именно держит аккаунт, и предлагаем
деактивацию.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.complaint import Complaint
from app.models.contract import Contract
from app.models.document import Document
from app.models.meeting import Meeting
from app.models.mentor_assignment import MentorAssignment
from app.models.mentor_assignment_history import MentorAssignmentHistory
from app.models.mentor_stage_reward import MentorStageReward
from app.models.mentor_task_penalty import MentorTaskPenalty
from app.models.mzk_quality_score import MzkQualityScore
from app.models.mzk_review import MzkReview
from app.models.payment import Payment
from app.models.roadmap import Roadmap
from app.models.student import Student
from app.models.student_task import StudentTask
from app.models.user_checkin import UserCheckin

# (подпись для человека, колонка). Подпись — то, что увидит админ в диалоге, так
# что она на русском и во множественном числе.
#
# Список намеренно не полный обход всех восьмидесяти ключей: сюда входит то, по
# чему видно, что человек работал. Аккаунт, не задевший ни одну из этих таблиц,
# ничего осмысленного за собой не оставил — приглашение, которым не
# воспользовались, или заведённый по ошибке дубль.
_SOURCES = (
    ("назначений на студентов", MentorAssignment.mentor_id),
    ("записей в истории замен", MentorAssignmentHistory.previous_mentor_id),
    ("договоров как МЗК", Contract.mzk_manager_id),
    ("платежей", Payment.mentor_id),
    ("загруженных документов", Document.uploaded_by),
    ("созданных задач", StudentTask.created_by),
    ("задач в работе", StudentTask.assignee_id),
    ("встреч", Meeting.mentor_id),
    ("роадмапов", Roadmap.mentor_id),
    ("оценок ОКК МЗК", MzkQualityScore.mzk_manager_id),
    ("отзывов ОКК", MzkReview.mzk_manager_id),
    ("вознаграждений за этапы", MentorStageReward.mentor_id),
    ("штрафов по задачам", MentorTaskPenalty.mentor_id),
    ("жалоб", Complaint.author_user_id),
    ("чекинов", UserCheckin.user_id),
    ("карточек ученика", Student.user_id),
)


async def user_blockers(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """Непустые следы аккаунта: `[{"entity": ..., "count": ...}, ...]`.

    Пустой список означает «удалять безопасно». Один запрос на источник — их
    полтора десятка, вызывается это только в диалоге удаления, и читаемость
    здесь важнее экономии на round-trip.
    """
    blockers: list[dict] = []
    for label, column in _SOURCES:
        count = await db.scalar(
            select(func.count()).select_from(column.parent.class_).where(column == user_id)
        )
        if count:
            blockers.append({"entity": label, "count": int(count)})
    return blockers


def describe_blockers(blockers: list[dict]) -> str:
    """Человеческая строка для 409: «3 назначения на студентов, 12 созданных задач»."""
    return ", ".join(f"{item['count']} {item['entity']}" for item in blockers)
