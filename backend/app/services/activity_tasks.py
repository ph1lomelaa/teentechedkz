from fastapi import HTTPException
from app.models.activity import StudentActivity

async def validate_activity_task(db, participation_id, student_id):
    participation = await db.get(StudentActivity, participation_id)
    if not participation or participation.student_id != student_id:
        raise HTTPException(404, 'Участие не найдено для этого ученика')
    if participation.status in ('completed', 'cancelled') or participation.decision == 'not_interested':
        raise HTTPException(409, 'Для закрытого участия нельзя добавлять задачи')
    return participation
