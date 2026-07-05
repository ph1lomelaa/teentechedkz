from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth,
    users,
    students,
    contracts,
    applications,
    services,
    guardians,
    payments,
    documents,
    portfolio,
    confidential_notes,
    tasks,
    countries,
    mentor_assignments,
    status_history,
    communication,
    notes,
    note_sessions,
    integrations,
    export,
    telegram_webhook,
    telegram_chats,
    sync,
    notion,
)

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(students.router)
api_router.include_router(contracts.router)
api_router.include_router(applications.router)
api_router.include_router(services.router)
api_router.include_router(guardians.router)
api_router.include_router(payments.router)
api_router.include_router(documents.router)
api_router.include_router(portfolio.router)
api_router.include_router(confidential_notes.router)
api_router.include_router(tasks.router)
api_router.include_router(countries.router)
api_router.include_router(mentor_assignments.router)
api_router.include_router(status_history.router)
api_router.include_router(communication.router)
api_router.include_router(notes.router)
api_router.include_router(note_sessions.router)
api_router.include_router(integrations.router)
api_router.include_router(export.router)
api_router.include_router(telegram_webhook.router)
api_router.include_router(telegram_chats.router)
api_router.include_router(sync.router)
api_router.include_router(notion.router)
