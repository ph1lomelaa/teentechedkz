"""Контракт ответов об ошибках (app/main.py).

Ради чего тест: раньше в main.py висели хендлеры, зарегистрированные по КОДУ
статуса (403 и 404). В Starlette такой хендлер приоритетнее остальных и
подменяет ответ целиком — вместе с `detail` и заголовками. Из-за этого весь
домен ошибок приложения (около десятка X-Error-Code: PASSWORD_CHANGE_REQUIRED,
AGREEMENT_SIGNATURE_REQUIRED, TASK_ACCEPTANCE_FORBIDDEN, ...) до фронта не
доходил: пользователь видел «Access denied» вместо причины, а обработчик смены
роли в client.ts ждал заголовок, которого уже не было.

Тестов на сквозной проход X-Error-Code не существовало — поэтому баг и дожил до
прода. Эти проверки закрывают ровно тот контракт, на который опирается фронт.

БД не нужна: TestClient не входит в контекстный менеджер, поэтому lifespan
(Redis, ws_hub) не стартует.
"""
import unittest

from fastapi import HTTPException
from starlette.testclient import TestClient

from app.main import app

# Служебные маршруты только для этих тестов: настоящие эндпоинты с кастомными
# X-Error-Code все требуют авторизации и живой БД, а проверить надо саму
# передачу заголовка и detail через хендлер.
_PREFIX = "/__error_contract_test__"


@app.get(f"{_PREFIX}/forbidden-with-code")
async def _raise_forbidden_with_code():
    raise HTTPException(
        status_code=403,
        detail="Сначала смените временный пароль",
        headers={"X-Error-Code": "PASSWORD_CHANGE_REQUIRED"},
    )


@app.get(f"{_PREFIX}/structured-detail")
async def _raise_structured_detail():
    raise HTTPException(
        status_code=409,
        detail={"message": "Этап нельзя начать", "missing_roles": ["lead", "career"]},
        headers={"X-Error-Code": "STAGE_REQUIRED_TEAM_INCOMPLETE"},
    )


@app.get(f"{_PREFIX}/boom")
async def _raise_unhandled():
    raise RuntimeError("нарочно ломаем, чтобы проверить хендлер 500")


class HttpExceptionPassthroughTests(unittest.TestCase):
    def setUp(self) -> None:
        # raise_server_exceptions=False: ServerErrorMiddleware после хендлера
        # пробрасывает исключение дальше (так его видят Sentry и логи uvicorn),
        # а TestClient по умолчанию из-за этого роняет тест вместо ответа.
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_error_code_header_survives(self) -> None:
        r = self.client.get(f"{_PREFIX}/forbidden-with-code")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.headers.get("x-error-code"), "PASSWORD_CHANGE_REQUIRED")

    def test_detail_is_not_replaced_by_generic_text(self) -> None:
        r = self.client.get(f"{_PREFIX}/forbidden-with-code")
        self.assertEqual(r.json()["detail"], "Сначала смените временный пароль")
        self.assertNotEqual(r.json()["detail"], "Access denied")

    def test_code_mirrored_into_body(self) -> None:
        r = self.client.get(f"{_PREFIX}/forbidden-with-code")
        self.assertEqual(r.json()["code"], "PASSWORD_CHANGE_REQUIRED")

    def test_structured_detail_survives(self) -> None:
        r = self.client.get(f"{_PREFIX}/structured-detail")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["missing_roles"], ["lead", "career"])

    def test_plain_403_gets_default_code_and_keeps_its_detail(self) -> None:
        # /auth/me без токена: HTTPBearer поднимает 403 «Not authenticated».
        # Раньше текст затирался на «Access denied» — причина отказа терялась.
        r = self.client.get("/api/v1/auth/me")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "FORBIDDEN")
        self.assertEqual(r.json()["detail"], "Not authenticated")

    def test_unknown_route_still_404(self) -> None:
        r = self.client.get("/api/v1/definitely-not-a-route")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["code"], "NOT_FOUND")


class UnhandledExceptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_error_id(self) -> None:
        r = self.client.get(f"{_PREFIX}/boom")
        self.assertEqual(r.status_code, 500)
        body = r.json()
        self.assertEqual(body["code"], "INTERNAL_ERROR")
        # error_id — то, что человек диктует в поддержку, а мы ищем грепом.
        self.assertTrue(body.get("error_id"))
        self.assertEqual(len(body["error_id"]), 12)

    def test_error_id_is_unique_per_request(self) -> None:
        first = self.client.get(f"{_PREFIX}/boom").json()["error_id"]
        second = self.client.get(f"{_PREFIX}/boom").json()["error_id"]
        self.assertNotEqual(first, second)

    def test_internals_are_not_leaked_to_client(self) -> None:
        r = self.client.get(f"{_PREFIX}/boom")
        self.assertNotIn("нарочно ломаем", r.text)
        self.assertNotIn("RuntimeError", r.text)
        self.assertNotIn("Traceback", r.text)
