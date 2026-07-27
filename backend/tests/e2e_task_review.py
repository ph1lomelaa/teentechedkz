"""End-to-end test of the student claim → mentor review flow (see STUDENT_MENTOR_FLOW_PLAN.md).

Runs against a live API using only the stdlib:

    python3 backend/tests/e2e_task_review.py [BASE_URL] [ADMIN_EMAIL] [ADMIN_PASSWORD]

Covers the permission/transition matrix:
admin login → create mentor + student + roadmap → grant portal access →
T1 claim (+idempotent repeat) → T2 unclaim → re-claim → T3 approve →
ALREADY_DONE → mentor notification → T4 return with mandatory comment →
re-claim after return → T5 implicit review via staff PATCH → S1 subtask
whitelist → foreign-student 404 non-disclosure → staff-PATCH 403 for student.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001") + "/api/v1"
ADMIN_EMAIL = sys.argv[2] if len(sys.argv) > 2 else "admin@teenteched.kz"
ADMIN_PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "Admin1234!"

_passed = 0
_failed = 0


def _req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            status = r.status
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read().decode()
    try:
        payload = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        payload = {"_raw": raw[:300]}
    return status, payload


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ✅ {name}")
    else:
        _failed += 1
        print(f"  ❌ {name}  {detail}")


def login(email, password):
    st, p = _req("POST", "/auth/login", body={"email": email, "password": password})
    assert st == 200, f"login {email} → {st}: {p}"
    return p["access_token"]


def main():
    print("E2E task review flow →", BASE)
    suffix = str(int(time.time()))
    admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)

    # --- фикстуры: ментор, студент, второй студент (для 404-непрозрачности), roadmap
    st, mentor_user = _req("POST", "/users", admin, {
        "name": f"E2E Ментор {suffix}", "email": f"e2e.mentor.{suffix}@test.kz",
        "password": "Mentor1234!", "role": "mentor",
    })
    check("создан ментор", st == 200 or st == 201, f"{st} {mentor_user}")
    mentor_id = mentor_user["id"]

    def _mk_student(name, tail):
        stt, s = _req("POST", "/students", admin, {
            "full_name": name, "phone": f"+7{tail}{suffix[-7:]}",
            "degree_level": "undergraduate", "intake_year": 2026,
        })
        assert stt in (200, 201), f"student create → {stt}: {s}"
        return s["id"]

    student_id = _mk_student(f"E2E Студент {suffix}", "701")
    check("создан студент", True)
    other_id = _mk_student(f"E2E Чужой {suffix}", "702")

    st, tpls = _req("GET", "/roadmap-templates", admin)
    assert st == 200 and tpls, "нет шаблонов roadmap"
    tpl_id = tpls[0]["id"]
    st, rm = _req("POST", f"/roadmap-templates/{tpl_id}/assign", admin,
                  {"student_id": student_id, "mentor_id": mentor_id})
    check("roadmap назначен", st == 201, f"{st}")
    tasks = [t for s in rm["stages"] for t in s["tasks"]]
    applicant_tasks = [t for t in tasks if t["audience"] == "applicant"]
    assert len(applicant_tasks) >= 3, "нужно ≥3 applicant-задачи в шаблоне"
    t_a, t_b, t_c = applicant_tasks[0], applicant_tasks[1], applicant_tasks[2]
    subtask_task = next((t for t in applicant_tasks if t["subtasks"]), None)

    st, rm_other = _req("POST", f"/roadmap-templates/{tpl_id}/assign", admin,
                        {"student_id": other_id, "mentor_id": mentor_id})
    other_task = [t for s in rm_other["stages"] for t in s["tasks"] if t["audience"] == "applicant"][0]

    st, grant = _req("POST", f"/students/{student_id}/grant-access", admin,
                     {"email": f"e2e.student.{suffix}@test.kz"})
    check("портальный доступ выдан", st == 201, f"{st}")
    invite_token = grant["invite_url"].rstrip("/").split("/")[-1]
    st, _ = _req("POST", f"/public/invite/{invite_token}/accept", body={"password": "Student1234!"})
    check("инвайт принят", st == 200, f"{st}")
    student_tok = login(f"e2e.student.{suffix}@test.kz", "Student1234!")
    mentor_tok = login(f"e2e.mentor.{suffix}@test.kz", "Mentor1234!")
    # Созданный через POST /users ментор заперт до смены временного пароля (Этап 0.5).
    st, _ = _req("POST", "/auth/change-password", mentor_tok,
                 {"old_password": "Mentor1234!", "new_password": "Mentor1234!"})
    check("ментор сменил временный пароль", st == 200, f"{st}")
    mentor_tok = login(f"e2e.mentor.{suffix}@test.kz", "Mentor1234!")

    # --- T1: заявка
    st, claim = _req("POST", f"/portal/tasks/{t_a['id']}/complete", student_tok)
    check("T1 заявка → 200", st == 200, f"{st} {claim}")
    check("T1 review_status=pending", claim and claim["task"]["review_status"] == "pending")
    check("T1 status НЕ done (истина ментора)", claim and claim["task"]["status"] != "done")
    check("T1 прогресс в ответе", claim and claim["progress"]["pending"] >= 1)

    st, claim2 = _req("POST", f"/portal/tasks/{t_a['id']}/complete", student_tok)
    check("T1 повтор идемпотентен → 200", st == 200, f"{st}")

    # --- нотификация ментору
    st, notes = _req("GET", "/notifications", mentor_tok)
    check("GET /notifications ментора → 200", st == 200, f"{st} {notes}")
    items = notes if isinstance(notes, list) else (notes or {}).get("items", [])
    has_claim_note = any(n.get("kind") == "task_review_requested" for n in items)
    check("ментор получил task_review_requested", has_claim_note, f"{[n.get('kind') for n in items][:5]}")

    # --- T2: снятие заявки
    st, un = _req("DELETE", f"/portal/tasks/{t_a['id']}/complete", student_tok)
    check("T2 снятие → 200, review_status=none", st == 200 and un["task"]["review_status"] == "none", f"{st}")
    st, un2 = _req("DELETE", f"/portal/tasks/{t_a['id']}/complete", student_tok)
    check("T2 повторное снятие → 409 NOT_PENDING", st == 409, f"{st}")

    # --- T3: подтверждение
    _req("POST", f"/portal/tasks/{t_a['id']}/complete", student_tok)
    st, rev = _req("POST", f"/roadmap-tasks/{t_a['id']}/review", mentor_tok, {"action": "approve"})
    check("T3 approve → 200", st == 200, f"{st} {rev}")
    approved = next(t for s in rev["stages"] for t in s["tasks"] if t["id"] == t_a["id"])
    check("T3 status=done + review_status=approved",
          approved["status"] == "done" and approved["review_status"] == "approved")
    st, _ = _req("POST", f"/roadmap-tasks/{t_a['id']}/review", mentor_tok, {"action": "approve"})
    check("T3 повторное ревью → 409 ALREADY_REVIEWED", st == 409, f"{st}")
    st, _ = _req("POST", f"/portal/tasks/{t_a['id']}/complete", student_tok)
    check("заявка на done-задачу → 409 ALREADY_DONE", st == 409, f"{st}")

    # --- T4: возврат с комментарием
    _req("POST", f"/portal/tasks/{t_b['id']}/complete", student_tok)
    st, _ = _req("POST", f"/roadmap-tasks/{t_b['id']}/review", mentor_tok, {"action": "return"})
    check("T4 возврат без комментария → 422", st == 422, f"{st}")
    st, rev = _req("POST", f"/roadmap-tasks/{t_b['id']}/review", mentor_tok,
                   {"action": "return", "comment": "Добавь мотивационную часть"})
    check("T4 возврат с комментарием → 200", st == 200, f"{st}")
    returned = next(t for s in rev["stages"] for t in s["tasks"] if t["id"] == t_b["id"])
    check("T4 status=in_progress + returned + comment",
          returned["status"] == "in_progress" and returned["review_status"] == "returned"
          and returned["review_comment"] == "Добавь мотивационную часть")
    st, reclaim = _req("POST", f"/portal/tasks/{t_b['id']}/complete", student_tok)
    check("повторная заявка после возврата → 200 pending", st == 200 and reclaim["task"]["review_status"] == "pending")

    # --- студент получил нотификации о вердиктах
    st, snotes = _req("GET", "/notifications", student_tok)
    sitems = snotes if isinstance(snotes, list) else (snotes or {}).get("items", [])
    kinds = {n.get("kind") for n in sitems}
    check("студенту пришли task_approved и task_returned",
          "task_approved" in kinds and "task_returned" in kinds, f"{kinds}")

    # --- T5: staff-PATCH поверх pending = неявное ревью
    st, patched = _req("PATCH", f"/roadmap-tasks/{t_b['id']}", mentor_tok, {"status": "done"})
    check("T5 staff PATCH status=done → 200", st == 200, f"{st}")
    t5 = next(t for s in patched["stages"] for t in s["tasks"] if t["id"] == t_b["id"])
    check("T5 review_status=approved (неявное подтверждение)", t5["review_status"] == "approved", t5["review_status"])

    # --- S1: сабтаски
    if subtask_task:
        sub = subtask_task["subtasks"][0]
        st, _ = _req("PATCH", f"/roadmap-subtasks/{sub['id']}", student_tok, {"is_done": True})
        check("S1 студент тогглит сабтаску → 200", st == 200, f"{st}")
        st, _ = _req("PATCH", f"/roadmap-subtasks/{sub['id']}", student_tok, {"title": "hack"})
        check("S1 запрет полей кроме is_done → 403", st == 403, f"{st}")
    else:
        print("  ⚠️ в шаблоне нет сабтасков — S1 пропущен")

    # --- изоляция и запреты
    st, _ = _req("POST", f"/portal/tasks/{other_task['id']}/complete", student_tok)
    check("чужая задача → 404 (без раскрытия)", st == 404, f"{st}")
    st, _ = _req("PATCH", f"/roadmap-tasks/{t_c['id']}", student_tok, {"status": "done"})
    check("staff-PATCH задачи студентом → 403", st == 403, f"{st}")
    st, _ = _req("POST", f"/roadmap-tasks/{t_c['id']}/review", student_tok, {"action": "approve"})
    check("ревью студентом → 403", st == 403, f"{st}")
    st, _ = _req("POST", f"/portal/tasks/{t_c['id']}/complete", mentor_tok)
    check("заявка ментором → 403 (не студент)", st == 403, f"{st}")

    # --- очередь ревью в workspace
    st, queue = _req("GET", "/workspace/roadmap-tasks?review_status=pending", mentor_tok)
    check("очередь ?review_status=pending отвечает", st == 200, f"{st}")

    print(f"\nИтого: ✅ {_passed} · ❌ {_failed}")
    sys.exit(1 if _failed else 0)


if __name__ == "__main__":
    main()
