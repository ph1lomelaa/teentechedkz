"""Live smoke test for the complete lead-to-account authentication journey.

Run against the local Docker stack:

    docker exec tte_backend python tests/e2e_auth_intake.py \
      http://127.0.0.1:8000/api/v1

The script creates uniquely marked records, exercises the HTTP API exactly as
the browser does, and removes its test data in ``finally``.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote_plus

import httpx
from dotenv import dotenv_values
from sqlalchemy import delete, or_, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# docker-compose gives the backend a URL with host `postgres`; this smoke test
# runs on the host, where the same container is published on 127.0.0.1:5432.
env_values = dotenv_values(REPO_ROOT / ".env")
if Path("/.dockerenv").exists():
    # Inside the backend container, compose already injects the correct URL.
    host_database_url = os.environ["DATABASE_URL"]
else:
    db_user = quote_plus(str(env_values.get("POSTGRES_USER") or "tte"))
    db_password = quote_plus(str(env_values.get("POSTGRES_PASSWORD") or "tte"))
    db_name = quote_plus(str(env_values.get("POSTGRES_DB") or "tte_db"))
    host_database_url = (
        f"postgresql+asyncpg://{db_user}:{db_password}@127.0.0.1:5432/{db_name}"
    )
    os.environ["DATABASE_URL"] = host_database_url

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.security import hash_password
from app.models.audit_log import AuditLog
from app.models.intake_submission import IntakeSubmission
from app.models.notification import Notification
from app.models.student import Student
from app.models.user import User, UserRole


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001/api/v1"


@dataclass
class Created:
    marker: str
    submission_ids: set[uuid.UUID] = field(default_factory=set)
    student_ids: set[uuid.UUID] = field(default_factory=set)
    user_ids: set[uuid.UUID] = field(default_factory=set)


def require(condition: bool, label: str, response: httpx.Response | None = None) -> None:
    if not condition:
        detail = ""
        if response is not None:
            detail = f" status={response.status_code} body={response.text[:500]}"
        raise AssertionError(label + detail)
    print(f"PASS {label}")


def bearer(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


async def cleanup(created: Created) -> None:
    async with AsyncSessionLocal() as db:
        # Notifications point at real admins, so remove them explicitly by the
        # unique marker rather than relying on user cascades.
        await db.execute(delete(Notification).where(Notification.body.ilike(f"%{created.marker}%")))
        if created.submission_ids:
            await db.execute(
                delete(IntakeSubmission).where(IntakeSubmission.id.in_(created.submission_ids))
            )
        if created.student_ids:
            for student_id in created.student_ids:
                student = await db.get(Student, student_id)
                if student:
                    await db.delete(student)
            await db.flush()
        if created.user_ids:
            await db.execute(
                delete(AuditLog).where(
                    or_(
                        AuditLog.actor_user_id.in_(created.user_ids),
                        AuditLog.target_user_id.in_(created.user_ids),
                    )
                )
            )
            for user_id in created.user_ids:
                user = await db.get(User, user_id)
                if user:
                    await db.delete(user)
        await db.commit()
    await engine.dispose()


async def create_test_admin(created: Created) -> tuple[str, str]:
    email = f"{created.marker}-admin@example.test"
    password = "AdminSmoke2026!"
    async with AsyncSessionLocal() as db:
        user = User(
            name=created.marker,
            email=email,
            hashed_password=hash_password(password),
            role=UserRole.admin,
            is_active=True,
            must_change_password=False,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        created.user_ids.add(user.id)
    await engine.dispose()
    return email, password


def main() -> None:
    marker = f"e2e-auth-{uuid.uuid4().hex[:10]}"
    created = Created(marker=marker)
    admin_email, admin_password = asyncio.run(create_test_admin(created))
    applicant_email = f"{marker}-student@example.com"
    mentor_email = f"{marker}-mentor@example.com"
    staff_email = f"{marker}-staff@example.com"

    admin = httpx.Client(base_url=BASE_URL, timeout=30)
    student = httpx.Client(base_url=BASE_URL, timeout=30)
    mentor = httpx.Client(base_url=BASE_URL, timeout=30)
    staff = httpx.Client(base_url=BASE_URL, timeout=30)

    try:
        health = httpx.get(BASE_URL.removesuffix("/api/v1") + "/health", timeout=10)
        require(health.status_code == 200, "backend health", health)

        login = admin.post(
            "/auth/login",
            json={
                "email": admin_email,
                "password": admin_password,
            },
        )
        require(login.status_code == 200, "admin login", login)
        admin_auth = bearer(login.json())
        require(admin.get("/auth/me", headers=admin_auth).status_code == 200, "admin /auth/me")

        application_body = {
            "full_name": f"{marker} Applicant",
            "phone": f"+7700{uuid.uuid4().int % 10_000_000:07d}",
            "email": applicant_email,
            "city": "Алматы",
            "degree_level": "undergraduate",
            "intake_year": 2028,
            "target_country": "США",
            "program_interest": "Computer Science",
            "message": marker,
        }
        application = admin.post("/public/applications", json=application_body)
        require(application.status_code == 201, "public application accepted", application)
        submission_id = uuid.UUID(application.json()["id"])
        created.submission_ids.add(submission_id)

        duplicate = admin.post("/public/applications", json=application_body)
        require(
            duplicate.status_code == 201 and duplicate.json()["id"] == str(submission_id),
            "double submit is idempotent",
            duplicate,
        )

        inbox = admin.get("/sync/submissions", headers=admin_auth, params={"status": "new"})
        require(
            inbox.status_code == 200
            and any(row["id"] == str(submission_id) for row in inbox.json()["items"]),
            "application appears in staff inbox",
            inbox,
        )

        converted = admin.post(
            f"/sync/submissions/{submission_id}/create-student", headers=admin_auth
        )
        require(converted.status_code == 200, "staff converts lead to student", converted)
        student_id = uuid.UUID(converted.json()["student_id"])
        created.student_ids.add(student_id)

        card = admin.get(f"/students/{student_id}", headers=admin_auth)
        require(card.status_code == 200, "created student card opens", card)
        card_data = card.json()
        require(card_data["phone"] == application_body["phone"], "lead phone survives conversion")
        require(card_data["city"] == "Алматы", "lead city survives conversion")
        require(card_data["intake_year"] == 2028, "lead intake year survives conversion")
        require(card_data["degree_level"] == "undergraduate", "lead degree survives conversion")
        require(card_data["specialty"] == "Computer Science", "lead program survives conversion")
        require(
            any(app["country"] == "США" for app in card_data["applications"]),
            "lead country becomes an application",
        )

        grant = admin.post(
            f"/students/{student_id}/grant-access",
            headers=admin_auth,
            json={"email": applicant_email},
        )
        require(grant.status_code == 201, "student portal access granted", grant)
        grant_data = grant.json()
        student_user_id = uuid.UUID(grant_data["user_id"])
        created.user_ids.add(student_user_id)

        temp_login = student.post(
            "/auth/login",
            json={"email": applicant_email, "password": grant_data["temp_password"]},
        )
        require(
            temp_login.status_code == 200
            and temp_login.json()["user"]["must_change_password"] is True,
            "temporary password login requires change",
            temp_login,
        )
        temp_auth = bearer(temp_login.json())
        blocked = student.get("/portal/profile", headers=temp_auth)
        require(blocked.status_code == 403, "temporary password cannot open portal", blocked)

        invite_token = grant_data["invite_url"].rstrip("/").split("/")[-1]
        invite_info = student.get(f"/public/invite/{invite_token}")
        require(
            invite_info.status_code == 200 and invite_info.json()["valid"] is True,
            "student invite is valid",
            invite_info,
        )
        accepted = student.post(
            f"/public/invite/{invite_token}/accept",
            json={"password": "StudentPass2026!"},
        )
        require(
            accepted.status_code == 200
            and accepted.json()["user"]["must_change_password"] is False,
            "invite sets permanent password and logs student in",
            accepted,
        )
        student_auth = bearer(accepted.json())
        require(
            student.get("/portal/profile", headers=student_auth).status_code == 200,
            "student opens own portal",
        )
        reused = student.post(
            f"/public/invite/{invite_token}/accept",
            json={"password": "AnotherPass2026!"},
        )
        require(reused.status_code == 410, "student invite is single use", reused)

        reset = admin.post(
            f"/students/{student_id}/reset-password", headers=admin_auth
        )
        require(reset.status_code == 200, "staff resets student password", reset)
        require(
            student.post("/auth/refresh").status_code == 401,
            "password reset revokes old refresh session",
        )
        reset_login = student.post(
            "/auth/login",
            json={"email": applicant_email, "password": reset.json()["temp_password"]},
        )
        require(
            reset_login.status_code == 200
            and reset_login.json()["user"]["must_change_password"] is True,
            "reset password is temporary",
            reset_login,
        )
        reset_auth = bearer(reset_login.json())
        unchanged = student.post(
            "/auth/change-password",
            headers=reset_auth,
            json={
                "old_password": reset.json()["temp_password"],
                "new_password": reset.json()["temp_password"],
            },
        )
        require(unchanged.status_code == 422, "password cannot be reused", unchanged)
        changed = student.post(
            "/auth/change-password",
            headers=reset_auth,
            json={
                "old_password": reset.json()["temp_password"],
                "new_password": "StudentFinal2026!",
            },
        )
        require(changed.status_code == 200, "student changes temporary password", changed)
        require(
            student.post(
                "/auth/login",
                json={"email": applicant_email, "password": "StudentFinal2026!"},
            ).status_code
            == 200,
            "student can login with final password",
        )

        deactivate = admin.patch(
            f"/students/{student_id}/access",
            headers=admin_auth,
            json={"is_active": False},
        )
        require(deactivate.status_code == 200, "student access deactivated", deactivate)
        require(student.post("/auth/refresh").status_code == 401, "deactivation revokes refresh")
        inactive_login = student.post(
            "/auth/login",
            json={"email": applicant_email, "password": "StudentFinal2026!"},
        )
        require(inactive_login.status_code == 401, "inactive student cannot login", inactive_login)
        reactivate = admin.patch(
            f"/students/{student_id}/access",
            headers=admin_auth,
            json={"is_active": True},
        )
        require(reactivate.status_code == 200, "student access reactivated", reactivate)

        signup = mentor.post(
            "/public/mentor-signup",
            json={
                "name": marker,
                "email": mentor_email,
                "phone": "+77001234567",
                "password": "MentorPass2026!",
            },
        )
        require(signup.status_code == 201, "mentor application accepted", signup)
        pending_login = mentor.post(
            "/auth/login",
            json={"email": mentor_email, "password": "MentorPass2026!"},
        )
        require(pending_login.status_code == 401, "pending mentor cannot login", pending_login)
        pending_users = admin.get(
            "/users",
            headers=admin_auth,
            params={"role": "mentor", "is_active": "false"},
        )
        mentor_row = next(row for row in pending_users.json() if row["email"] == mentor_email)
        mentor_user_id = uuid.UUID(mentor_row["id"])
        created.user_ids.add(mentor_user_id)
        activated = admin.patch(
            f"/users/{mentor_user_id}",
            headers=admin_auth,
            json={"is_active": True},
        )
        require(activated.status_code == 200, "admin approves mentor", activated)
        mentor_login = mentor.post(
            "/auth/login",
            json={"email": mentor_email, "password": "MentorPass2026!"},
        )
        require(mentor_login.status_code == 200, "approved mentor can login", mentor_login)
        mentor_auth = bearer(mentor_login.json())
        require(
            mentor.get("/workspace/dashboard", headers=mentor_auth).status_code == 200,
            "mentor reaches staff workspace",
        )
        deleted = admin.delete(f"/users/{mentor_user_id}", headers=admin_auth)
        require(deleted.status_code == 200, "admin deactivates mentor", deleted)
        require(mentor.post("/auth/refresh").status_code == 401, "admin deactivation revokes mentor session")

        staff_invite = admin.post(
            "/users/invite",
            headers=admin_auth,
            json={"name": marker, "email": staff_email, "role": "mzk_manager"},
        )
        require(staff_invite.status_code == 200, "staff invite created", staff_invite)
        staff_data = staff_invite.json()
        staff_user_id = uuid.UUID(staff_data["id"])
        created.user_ids.add(staff_user_id)
        require(
            staff.post(
                "/auth/login",
                json={"email": staff_email, "password": "StaffPass2026!"},
            ).status_code
            == 401,
            "invited staff cannot login before acceptance",
        )
        staff_token = staff_data["invite_url"].rstrip("/").split("/")[-1]
        staff_accept = staff.post(
            f"/public/invite/{staff_token}/accept",
            json={"password": "StaffPass2026!"},
        )
        require(staff_accept.status_code == 200, "staff accepts invite", staff_accept)
        require(
            staff_accept.json()["user"]["role"] == "mzk_manager",
            "staff invite preserves assigned role",
        )
        require(
            staff.post(f"/public/invite/{staff_token}/accept", json={"password": "OtherPass2026!"}).status_code
            == 410,
            "staff invite is single use",
        )

        staff_auth = bearer(staff_accept.json())
        logout_all = staff.post("/auth/logout-all", headers=staff_auth)
        require(logout_all.status_code == 200, "logout-all succeeds", logout_all)
        require(staff.post("/auth/refresh").status_code == 401, "logout-all revokes refresh")

        print("AUTH/INTAKE E2E PASSED")
    finally:
        admin.close()
        student.close()
        mentor.close()
        staff.close()
        asyncio.run(cleanup(created))


if __name__ == "__main__":
    main()
