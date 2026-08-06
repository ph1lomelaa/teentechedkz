"""E2E для Блока 4: откат задачи в завершённом этапе + видимость для студента.

Проверяет ровно то, что чинилось:
  A. ментор может снять отметку с задачи в этапе, доведённом до done;
     этап при этом сам возвращается в работу (каскад);
  B. скрытая задача и скрытый этап пропадают у студента, но остаются у staff;
  C. студент не может заявить выполнение по скрытой задаче (404).
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001") + "/api/v1"
_passed = _failed = 0


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, cond, extra=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ✅ {name}")
    else:
        _failed += 1
        print(f"  ❌ {name} {extra}")


def login(email, pw):
    st, d = req("POST", "/auth/login", body={"email": email, "password": pw})
    assert st == 200, (st, d)
    return d["access_token"]


suffix = str(int(time.time()))
admin = login("admin@teenteched.kz", "Admin1234!")

# --- фикстура: ментор, студент, roadmap
st, mentor = req("POST", "/users", admin, {
    "name": f"B4 Ментор {suffix}", "email": f"b4.mentor.{suffix}@test.kz",
    "password": "Mentor1234!", "role": "mentor",
})
assert st in (200, 201), mentor
mentor_id = mentor["id"]

st, stu = req("POST", "/students", admin, {
    "full_name": f"B4 Студент {suffix}", "phone": f"7{suffix[-9:]}",
    "degree_level": "undergraduate", "intake_year": 2026,
})
assert st in (200, 201), stu
student_id = stu["id"]

# Свой шаблон, а не первый попавшийся: тесту нужны >=2 обязательные задачи в
# одном этапе, иначе каскад отката проверить не на чем.
TEMPLATE_NAME = "E2E visibility fixture"
st, tpls = req("GET", "/roadmap-templates", admin)
tpl_id = next((t["id"] for t in (tpls or []) if t["name"] == TEMPLATE_NAME), None)
if tpl_id is None:
    st, tpl = req("POST", "/roadmap-templates", admin, {
        "name": TEMPLATE_NAME, "country_name": "Казахстан",
        "degree": "bachelors", "year": 2026, "description": "fixture",
    })
    assert st in (200, 201), tpl
    tpl_id = tpl["id"]
st, _struct = req("PUT", f"/roadmap-templates/{tpl_id}/structure", admin, {
    "stages": [{
        "name": "Этап 1", "description": "",
        "tasks": [
            {"title": "Задача 1", "priority": "required", "audience": "applicant"},
            {"title": "Задача 2", "priority": "required", "audience": "applicant"},
            {"title": "Задача 3", "priority": "required", "audience": "applicant"},
            {"title": "Задача 4", "priority": "recommended", "audience": "applicant"},
        ],
    }]
})
assert st == 200, _struct
st, rm = req("POST", f"/roadmap-templates/{tpl_id}/assign", admin,
             {"student_id": student_id, "mentor_id": mentor_id})
assert st == 201, rm
roadmap_id = rm["id"]
stage = rm["stages"][0]
stage_id = stage["id"]
required = [t for t in stage["tasks"] if t["priority"] == "required"]

print("\n--- A. каскад: откат задачи в завершённом этапе ---")
# закрываем все обязательные задачи
for t in required:
    st, _ = req("PATCH", f"/roadmap-tasks/{t['id']}", admin, {"status": "done"})
    assert st == 200, st
# завершаем этап
st, after = req("PATCH", f"/stages/{stage_id}", admin, {"status": "done"})
check("этап завершён", st == 200 and
      next(s for s in after["stages"] if s["id"] == stage_id)["status"] == "done", f"{st}")

# снимаем отметку с одной задачи — это и был сломанный сценарий
st, rolled = req("PATCH", f"/roadmap-tasks/{required[0]['id']}", admin, {"status": "planned"})
check("откат задачи → 200 (раньше ломалось)", st == 200, f"{st} {rolled}")
if st == 200:
    tsk = next(t for s in rolled["stages"] for t in s["tasks"] if t["id"] == required[0]["id"])
    stg = next(s for s in rolled["stages"] if s["id"] == stage_id)
    check("задача снова planned", tsk["status"] == "planned", tsk["status"])
    check("этап каскадом вернулся в in_progress", stg["status"] == "in_progress", stg["status"])

print("\n--- B. видимость для студента ---")
st, grant = req("POST", f"/students/{student_id}/grant-access", admin,
                {"email": f"b4.student.{suffix}@test.kz"})
assert st == 201, grant
token_ = grant["invite_url"].rstrip("/").split("/")[-1]
st, _ = req("POST", f"/public/invite/{token_}/accept", body={"password": "Student1234!"})
assert st == 200, st
stud = login(f"b4.student.{suffix}@test.kz", "Student1234!")

st, before = req("GET", "/portal/tasks", stud)
visible_before = len(before)
check("студент видит задачи изначально", visible_before > 0, str(visible_before))

hide_task = required[1]
st, _ = req("PATCH", f"/roadmap-tasks/{hide_task['id']}", admin, {"visible_to_student": False})
check("PATCH visible_to_student=false → 200", st == 200, f"{st}")

st, after_hide = req("GET", "/portal/tasks", stud)
ids_after = {t["id"] for t in after_hide}
check("скрытая задача пропала у студента", hide_task["id"] not in ids_after)
check("остальные задачи на месте", len(after_hide) == visible_before - 1,
      f"{len(after_hide)} vs {visible_before}")

st, staff_view = req("GET", f"/students/{student_id}/tasks", admin)
check("staff по-прежнему видит скрытую задачу",
      hide_task["id"] in {t["id"] for t in staff_view})

# C. заявка по скрытой задаче
st, claim = req("POST", f"/portal/tasks/{hide_task['id']}/complete", stud)
check("заявка по скрытой задаче → 404", st == 404, f"{st} {claim}")

# скрываем этап целиком
st, _ = req("PATCH", f"/stages/{stage_id}", admin, {"visible_to_student": False})
check("PATCH этапа visible_to_student=false → 200", st == 200, f"{st}")

st, after_stage = req("GET", "/portal/roadmap", stud)
stage_ids = {s["id"] for r in after_stage for s in r["stages"]}
check("скрытый этап пропал у студента", stage_id not in stage_ids)

st, tasks_after_stage = req("GET", "/portal/tasks", stud)
check("задачи скрытого этапа тоже пропали", len(tasks_after_stage) == 0,
      str(len(tasks_after_stage)))

st, staff_after = req("GET", f"/students/{student_id}/roadmap", admin)
staff_stage_ids = {s["id"] for r in staff_after for s in r["stages"]}
check("staff видит скрытый этап", stage_id in staff_stage_ids)

print(f"\nИтого: ✅ {_passed} · ❌ {_failed}")
raise SystemExit(1 if _failed else 0)
