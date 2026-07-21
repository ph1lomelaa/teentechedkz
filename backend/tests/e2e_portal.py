"""End-to-end smoke test for the student-portal integration.

Runs against a live API (default http://localhost:8001) using only the stdlib —
no pytest/deps required:

    python3 backend/tests/e2e_portal.py [BASE_URL] [ADMIN_EMAIL] [ADMIN_PASSWORD]

Exercises: admin login → create student → grant portal access → assign roadmap
→ student login + forced password change → roadmap/tasks/meetings/country templates
→ role-gating. Prints PASS/FAIL per step and exits non-zero on any failure.
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001") + "/api/v1"
ADMIN_EMAIL = sys.argv[2] if len(sys.argv) > 2 else "admin@teenteched.kz"
ADMIN_PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "Admin1234!"

_passed = 0
_failed = 0


def _req(method, path, token=None, body=None, expect=None):
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
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} → {status} (expected {expect}): {raw[:200]}")
    return status, payload


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ✅ {name}")
    else:
        _failed += 1
        print(f"  ❌ {name}  {detail}")


def main():
    print("E2E portal test →", BASE)

    # 1. admin login
    st, data = _req("POST", "/auth/login", body={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    check("admin login", st == 200 and data and data.get("access_token"), f"status={st}")
    admin = data["access_token"]

    # 2. create student
    st, student = _req("POST", "/students", admin, {
        "full_name": "E2E Тест Студент", "phone": f"+7700{int(time.time()) % 10000000}",
        "degree_level": "undergraduate", "intake_year": 2026,
    })
    check("create student", st in (200, 201) and student and student.get("id"), f"status={st}")
    sid = student["id"]

    # 3. grant portal access
    email = f"e2e_student_{int(time.time())}@example.com"
    st, grant = _req("POST", f"/students/{sid}/grant-access", admin, {"email": email})
    if st != 201:
        print("   detail:", grant)
    check("grant portal access", st == 201 and grant and grant.get("temp_password"), f"status={st}")
    temp_pw = grant["temp_password"]

    # 4. access status reflects the new account
    st, acc = _req("GET", f"/students/{sid}/access", admin)
    check("access status = has_access", st == 200 and acc.get("has_access") is True, f"status={st}")

    # 5. assign roadmap template
    st, templates = _req("GET", "/roadmap-templates", admin)
    check("templates listed", st == 200 and len(templates) >= 1, f"status={st}")
    tid = templates[0]["id"]
    st, roadmap = _req("POST", f"/roadmap-templates/{tid}/assign", admin, {"student_id": sid})
    check("assign roadmap", st == 201 and roadmap and len(roadmap.get("stages", [])) > 0, f"status={st}")

    # 6. staff sees the student's roadmap
    st, rm = _req("GET", f"/students/{sid}/roadmap", admin)
    check("staff GET student roadmap", st == 200 and rm and rm.get("id"), f"status={st}")
    first_task = rm["stages"][0]["tasks"][0]

    # 7. schedule a meeting
    st, meeting = _req("POST", "/meetings", admin, {
        "student_id": sid, "title": "E2E встреча",
        "starts_at": "2026-08-01T09:00:00Z", "ends_at": "2026-08-01T09:45:00Z",
        "meeting_link": "https://example.com/meet",
    })
    check("create meeting", st == 201 and meeting.get("id"), f"status={st}")

    # 8. student login (temp password) — must change
    st, slog = _req("POST", "/auth/login", body={"email": email, "password": temp_pw})
    check("student login", st == 200 and slog.get("user", {}).get("must_change_password") is True, f"status={st}")
    student_tok = slog["access_token"]

    # 9. student changes password
    st, _ = _req("POST", "/auth/change-password", student_tok, {"old_password": temp_pw, "new_password": "NewPass123!"})
    check("student change password", st == 200, f"status={st}")

    # 10. student sees own roadmap
    st, my_rm = _req("GET", "/portal/roadmap", student_tok)
    check("student GET /portal/roadmap", st == 200 and my_rm and my_rm.get("student_id") == sid, f"status={st}")

    # 11. student marks a task done
    st, upd = _req("PATCH", f"/roadmap-tasks/{first_task['id']}", student_tok, {"status": "done"})
    done = any(t["id"] == first_task["id"] and t["status"] == "done" for s in upd["stages"] for t in s["tasks"])
    check("student marks task done", st == 200 and done, f"status={st}")

    # 12. student flat tasks
    st, tasks = _req("GET", "/portal/tasks", student_tok)
    check("student GET /portal/tasks", st == 200 and len(tasks) > 0, f"status={st}")

    # 13. student sees the meeting
    st, meetings = _req("GET", "/portal/meetings", student_tok)
    check("student GET /portal/meetings", st == 200 and len(meetings) == 1, f"status={st}")

    # 14. university credentials feature is disabled for every role
    st, _ = _req("GET", "/portal/credentials", student_tok)
    check("university credentials endpoint removed", st == 404, f"status={st}")

    # 15. template previews are readable, authoring remains role-gated
    st, student_templates = _req("GET", "/roadmap-templates", student_tok)
    check("student reads country roadmap templates", st == 200 and len(student_templates) > 0, f"status={st}")
    st, _ = _req("POST", "/universities", student_tok, {"name": "Hack U"})
    check("student blocked from creating university (403)", st == 403, f"status={st}")

    # 16. universities catalog readable by student
    st, unis = _req("GET", "/universities", student_tok)
    check("student reads universities catalog", st == 200 and len(unis) >= 1, f"status={st}")

    print(f"\n{'='*40}\nPASSED {_passed} / {_passed + _failed}")
    if _failed:
        print(f"FAILED {_failed}")
        sys.exit(1)
    print("ALL GREEN ✅")


if __name__ == "__main__":
    main()
