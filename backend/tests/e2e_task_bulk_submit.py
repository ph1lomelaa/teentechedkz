"""E2E: массовое назначение задач + сдача с текстом и файлом."""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid

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


def upload(path, token, filename, content, mime):
    boundary = "----b" + uuid.uuid4().hex
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
    body += f"Content-Type: {mime}\r\n\r\n".encode()
    body += content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    r = urllib.request.Request(BASE + path, data=body, method="POST")
    r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


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

# два ментора для проверки рассылки
mentor_ids = []
mentor_toks = []
for i in (1, 2):
    st, m = req("POST", "/users", admin, {
        "name": f"BS Ментор {i} {sfx}", "email": f"bs.m{i}.{sfx}@test.kz",
        "password": "Mentor1234!", "role": "mentor",
    })
    assert st in (200, 201), m
    mentor_ids.append(m["id"])
    tok = login(f"bs.m{i}.{sfx}@test.kz", "Mentor1234!")
    req("POST", "/auth/change-password", tok,
        {"old_password": "Mentor1234!", "new_password": "MentorFinal1234!"})
    tok = login(f"bs.m{i}.{sfx}@test.kz", "MentorFinal1234!")
    st, pend = req("GET", "/agreements/pending", tok)
    for a in (pend or {}).get("items", []):
        if not a.get("signed"):
            req("POST", f"/agreements/{a['id']}/sign", tok,
                {"full_name_typed": "BS Ментор", "checkbox_acknowledged": True})
    mentor_toks.append(login(f"bs.m{i}.{sfx}@test.kz", "MentorFinal1234!"))

print("\n--- 1. массовое назначение по списку ---")
st, res = req("POST", "/tasks/bulk", admin, {
    "task_text": f"Групповая задача {sfx}",
    "assignee_ids": mentor_ids,
    "sla_hours": 24,
})
check("bulk по списку → 200", st == 200, f"{st} {res}")
check("создано ровно 2 задачи", res and res.get("created_count") == 2, str(res)[:200])
check("у каждой свой исполнитель",
      res and len({t["assignee_id"] for t in res["created"]}) == 2)
check("у каждой свой дедлайн SLA",
      res and all(t["sla_due_at"] for t in res["created"]))

print("\n--- 2. «всем менторам» ---")
st, res_all = req("POST", "/tasks/bulk", admin, {
    "task_text": f"Всем менторам {sfx}", "all_mentors": True, "sla_hours": 48,
})
check("bulk всем менторам → 200", st == 200, f"{st}")
count_all = res_all.get("created_count", 0) if isinstance(res_all, dict) else 0
check("создано задач >= 2", count_all >= 2, str(count_all))
check("наши менторы попали в рассылку",
      res_all and {*mentor_ids} <= {t["assignee_id"] for t in res_all["created"]})

st, dup = req("POST", "/tasks/bulk", admin, {
    "task_text": f"Дедуп {sfx}", "all_mentors": True, "assignee_ids": mentor_ids,
})
ids_created = [t["assignee_id"] for t in dup["created"]] if isinstance(dup, dict) else []
check("дублей нет: один исполнитель — одна задача",
      len(ids_created) == len(set(ids_created)), str(len(ids_created)))

print("\n--- 3. права и валидация ---")
st, denied = req("POST", "/tasks/bulk", mentor_toks[0], {
    "task_text": "ментор рассылает", "all_mentors": True,
})
check("ментор не может рассылать → 403", st == 403, f"{st}")

st, empty = req("POST", "/tasks/bulk", admin, {"task_text": "без исполнителей"})
check("без исполнителей → 422", st == 422, f"{st}")

print("\n--- 4. сдача с результатом и файлом ---")
my_task = next(t for t in res["created"] if t["assignee_id"] == mentor_ids[0])
tid = my_task["id"]

png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
st, up = upload(f"/tasks/{tid}/evidence", mentor_toks[0], "proof.png", png, "image/png")
check("файл-подтверждение загружен", st == 200, f"{st} {up}")

st, ev = req("GET", f"/tasks/{tid}/evidence", mentor_toks[0])
check("файл виден в списке подтверждений",
      isinstance(ev, list) and len(ev) == 1, str(ev)[:200])
check("файл общей задачи лежит не в students/None",
      isinstance(ev, list) and ev and "None" not in ev[0].get("file_name", ""))

st, done = req("PATCH", f"/tasks/{tid}", mentor_toks[0], {
    "result_text": "Отчёт готов, приложил скриншот",
    "status": "submitted",
})
check("задача сдана с текстом результата", st == 200, f"{st} {done}")
check("result_text сохранён",
      done and done.get("result_text") == "Отчёт готов, приложил скриншот", str(done)[:200])
check("статус submitted", done and done.get("status") == "submitted")

st, foreign = upload(f"/tasks/{tid}/evidence", mentor_toks[1], "x.png", png, "image/png")
check("чужой ментор не может грузить подтверждение → 403", foreign and st == 403, f"{st}")

st, bad = upload(f"/tasks/{tid}/evidence", mentor_toks[0], "x.exe", b"MZ", "application/x-msdownload")
check("недопустимый тип файла → 422", st == 422, f"{st}")

print(f"\nИтого: ✅ {_passed} · ❌ {_failed}")
raise SystemExit(1 if _failed else 0)
