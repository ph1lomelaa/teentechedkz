"""E2E Блоков 1-3: задачи менторам, SLA/санкции, чекины.

Проверяет ровно то, что строилось:
  1. МЗК ставит задачу ментору — и по студенту, и общую (без student_id);
     фильтры доски (assignee_id / kind / overdue) работают.
  2. Просроченная задача получает санкцию по ступеням, повторный проход
     цикла её не дублирует (идемпотентность).
  3. Чекин: отметка, статус, повтор, сводка для МЗК, запрет для студента.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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


sfx = str(int(time.time()))
admin = login("admin@teenteched.kz", "Admin1234!")

# --- фикстура
st, mentor = req("POST", "/users", admin, {
    "name": f"B1 Ментор {sfx}", "email": f"b1.mentor.{sfx}@test.kz",
    "password": "Mentor1234!", "role": "mentor",
})
assert st in (200, 201), mentor
mentor_id = mentor["id"]
st, _ = req("POST", "/auth/change-password", login(f"b1.mentor.{sfx}@test.kz", "Mentor1234!"),
            {"old_password": "Mentor1234!", "new_password": "MentorFinal1234!"})
mentor_tok = login(f"b1.mentor.{sfx}@test.kz", "MentorFinal1234!")

# Подписываем регламенты ментора: пока висит неподписанный, задача уходит в
# awaiting_signature и SLA намеренно не тикает — проверять санкции надо на
# «рабочем» менторе.
st, pending = req("GET", "/agreements/pending", mentor_tok)
for a in (pending or {}).get("items", []):
    if not a.get("signed"):
        req("POST", f"/agreements/{a['id']}/sign", mentor_tok,
            {"full_name_typed": "B1 Ментор", "checkbox_acknowledged": True})

st, stu = req("POST", "/students", admin, {
    "full_name": f"B1 Студент {sfx}", "phone": f"7{sfx[-9:]}",
    "degree_level": "undergraduate", "intake_year": 2026,
})
assert st in (200, 201), stu
student_id = stu["id"]

print("\n--- 1. задачи менторам ---")
st, general = req("POST", "/tasks", admin, {
    "task_text": f"Сдать отчёт {sfx}",
    "assignee_id": mentor_id,
})
check("общая задача без student_id → создана", st in (200, 201), f"{st} {general}")
if isinstance(general, dict) and general.get("id"):
    check("student_id = null (не строка 'None')", general.get("student_id") is None,
          repr(general.get("student_id")))
    check("SLA проставлен по умолчанию 24ч", general.get("sla_hours") == 24, str(general.get("sla_hours")))
    check("дедлайн SLA посчитан", bool(general.get("sla_due_at")))
    check("задача пока не просрочена", general.get("sla_overdue") is False, str(general.get("sla_overdue")))
general_id = general["id"] if isinstance(general, dict) else None

st, custom = req("POST", "/tasks", admin, {
    "task_text": f"Задача с явным SLA {sfx}",
    "assignee_id": mentor_id, "sla_hours": 48,
})
check("явный sla_hours принят", isinstance(custom, dict) and custom.get("sla_hours") == 48,
      str(custom))

st, no_sla = req("POST", "/tasks", admin, {
    "task_text": f"Без срока {sfx}", "assignee_id": mentor_id, "sla_hours": None,
})
check("sla_hours=null отключает SLA",
      isinstance(no_sla, dict) and no_sla.get("sla_hours") is None and no_sla.get("sla_due_at") is None,
      str(no_sla))

st, bad = req("POST", "/tasks", admin, {
    "task_text": "плохой SLA", "assignee_id": mentor_id, "sla_hours": -5,
})
check("отрицательный sla_hours → 422", st == 422, f"{st}")

st, mentor_general = req("POST", "/tasks", mentor_tok, {"task_text": "ментор ставит общую"})
check("ментор не может ставить общие задачи → 403", st == 403, f"{st}")

# фильтры доски
st, board = req("GET", f"/tasks?assignee_id={mentor_id}&kind=general", admin)
check("фильтр kind=general отдаёт общие задачи",
      isinstance(board, dict) and board.get("total", 0) >= 3, str(board.get("total")))
if isinstance(board, dict):
    check("в general нет задач со студентом",
          all(i["student_id"] is None for i in board["items"]))

st, board_student = req("GET", f"/tasks?assignee_id={mentor_id}&kind=student", admin)
check("фильтр kind=student пуст (задач по студенту ещё нет)",
      isinstance(board_student, dict) and board_student.get("total") == 0,
      str(board_student.get("total")))

st, mine = req("GET", "/tasks?scope=mine", mentor_tok)
check("ментор видит свои общие задачи (скоуп по assignee)",
      isinstance(mine, dict) and mine.get("total", 0) >= 3, str(mine.get("total")))

st, forbidden = req("GET", f"/tasks?assignee_id={sfx and mentor_id}", mentor_tok)
check("ментор может смотреть только себя → 200", forbidden is not None and st == 200, f"{st}")

print("\n--- 2. SLA: просрочка и санкция ---")
# делаем задачу просроченной прямо в БД и дёргаем цикл
subprocess.run([
    "docker", "compose", "exec", "-T", "postgres", "psql", "-U", "tte", "-d", "tte_db",
    "-c", f"update student_tasks set sla_due_at = now() - interval '2 hours' where id = '{general_id}'",
], capture_output=True, cwd=REPO_ROOT)

run_cycle = [
    "docker", "compose", "exec", "-T", "worker", "python", "-c",
    "import asyncio;from app.services.task_sla_notifier import check_task_sla;asyncio.run(check_task_sla())",
]
r1 = subprocess.run(run_cycle, capture_output=True, cwd=REPO_ROOT)
check("цикл SLA отработал без ошибок", r1.returncode == 0, r1.stderr.decode()[-300:])

st, after = req("GET", f"/tasks?assignee_id={mentor_id}&kind=general", admin)
task_after = next((i for i in after["items"] if i["id"] == general_id), None)
check("задача помечена overdue", task_after and task_after["status"] == "overdue",
      task_after and task_after["status"])
check("санкция записана в задаче", task_after and task_after["sla_penalty_color"] == "yellow",
      task_after and task_after["sla_penalty_color"])
check("sla_overdue=true", task_after and task_after["sla_overdue"] is True)

st, pens = req("GET", f"/mentor-task-penalties?mentor_id={mentor_id}", admin)
n1 = len(pens.get("items", [])) if isinstance(pens, dict) else -1
check("санкция появилась в реестре", n1 == 1, f"{n1} {str(pens)[:200]}")

# второй проход — идемпотентность
r2 = subprocess.run(run_cycle, capture_output=True, cwd=REPO_ROOT)
st, pens2 = req("GET", f"/mentor-task-penalties?mentor_id={mentor_id}", admin)
n2 = len(pens2.get("items", [])) if isinstance(pens2, dict) else -1
check("повторный проход НЕ дублирует санкцию (идемпотентность)", n2 == n1, f"{n1} -> {n2}")

print("\n--- 2b. SLA не тикает под гейтом регламента ---")
st, gated = req("POST", "/users", admin, {
    "name": f"B1 Гейт {sfx}", "email": f"b1.gated.{sfx}@test.kz",
    "password": "Gated1234!", "role": "mentor",
})
gated_id = gated["id"]
st, gated_task = req("POST", "/tasks", admin, {
    "task_text": f"Задача под гейтом {sfx}", "assignee_id": gated_id,
})
check("задача заперта регламентом", gated_task.get("status") == "awaiting_signature",
      str(gated_task.get("status")))
check("часы SLA не стартовали (sla_due_at пуст)", gated_task.get("sla_due_at") is None,
      str(gated_task.get("sla_due_at")))
check("но срок SLA сохранён на будущее", gated_task.get("sla_hours") == 24,
      str(gated_task.get("sla_hours")))

st, unblocked = req("PATCH", f"/tasks/{gated_task['id']}", admin, {"status": "open"})
check("после снятия гейта часы стартуют", unblocked.get("sla_due_at") is not None,
      str(unblocked.get("sla_due_at")))

print("\n--- 3. чекины ---")
st, today = req("GET", "/checkins/me/today", mentor_tok)
check("GET /checkins/me/today → 200", st == 200, f"{st}")
check("для ментора чекин обязателен", today and today.get("required") is True, str(today))
check("окно отдаётся фронту", today and today.get("window", {}).get("hour") == 10)

st, done = req("POST", "/checkins/me", mentor_tok, {"note": "на месте"})
check("чекин записан", st == 200 and done.get("status") in ("on_time", "late"), f"{st} {done}")
first_status = done.get("status") if isinstance(done, dict) else None

st, again = req("POST", "/checkins/me", mentor_tok)
check("повторный чекин идемпотентен (та же отметка)",
      st == 200 and again.get("status") == first_status, f"{st} {again}")

st, today2 = req("GET", "/checkins/me/today", mentor_tok)
check("сегодняшняя отметка видна", today2 and today2.get("checkin") is not None)

st, admin_checkin = req("POST", "/checkins/me", admin)
check("админ не обязан отмечаться → 403", st == 403, f"{st}")

st, lst = req("GET", "/checkins?days=7", admin)
check("сводка для админа → 200", st == 200 and "items" in (lst or {}), f"{st}")
check("сотрудники перечислены", lst and len(lst.get("staff", [])) > 0)
check("наша отметка попала в сводку",
      lst and any(i["user_id"] == mentor_id for i in lst["items"]))

st, summary = req("GET", "/checkins/summary?days=7", admin)
check("счётчики по сотрудникам → 200", st == 200 and "items" in (summary or {}), f"{st}")
row = next((i for i in summary.get("items", []) if i["user_id"] == mentor_id), None)
check("у ментора засчитана отметка", row and (row["on_time"] + row["late"]) == 1, str(row))

st, denied = req("GET", "/checkins", mentor_tok)
check("ментор не видит чужую сводку → 403", st == 403, f"{st}")

print(f"\nИтого: ✅ {_passed} · ❌ {_failed}")
raise SystemExit(1 if _failed else 0)
