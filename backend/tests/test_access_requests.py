"""Самозапись: когда человека пускают без админа, а когда — нет.

Ради чего тест
--------------
Авто-привязка выдаёт кабинет чужой карточки молча. Ошибка здесь не роняет
запрос и не пишет в лог ничего подозрительного — она просто отдаёт человеку
чужие документы, и обнаруживается жалобой. Это ровно тот случай, где решение
обязано быть отделено от базы и покрыто явно.

Проверяются три условия авто-привязки, каждое по отдельности: совпадение
именно по телефону, свободная карточка и уникальность номера в базе. Матчинг
(`fuzzy_match`) сам по себе не тестируется — он старше этого кода и покрыт
своим местом; здесь проверяется наш вердикт поверх него.
"""
import unittest
import uuid
from unittest import mock

from app.api.v1.endpoints.public import _mentor_code_matches
from fastapi import HTTPException

from app.api.v1.endpoints import access_requests as endpoints
from app.models.access_request import STATUS_APPROVED, STATUS_NEW
from app.models.user import UserRole
from app.services.access_requests import (
    backfill_unlinked_student_requests,
    find_student_candidates,
    link_user_to_student,
    prepare_candidate_index,
    suggest_student,
)

FREE_CARD = uuid.uuid4()
TAKEN_CARD = uuid.uuid4()
TWIN_A = uuid.uuid4()
TWIN_B = uuid.uuid4()

PHONE = "+7 707 123 45 67"
OTHER_PHONE = "+7 701 000 11 22"


def _index(*rows: dict) -> list[dict]:
    return list(rows)


def _card(card_id, name, phone, user_id=None, year=2027) -> dict:
    return {
        "id": card_id,
        "full_name": name,
        "phone": phone,
        "intake_year": year,
        "user_id": user_id,
    }


class AutoLinkTests(unittest.TestCase):
    def test_exact_phone_on_free_card_is_auto_linkable(self) -> None:
        index = _index(_card(FREE_CARD, "Иванов Иван", PHONE))
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertTrue(s.auto_linkable)
        self.assertEqual(s.student_id, FREE_CARD)
        self.assertEqual(s.method, "phone_exact")

    def test_phone_format_does_not_matter(self) -> None:
        # Человек вводит номер как привык. Совпадение считается по цифрам,
        # иначе «8 707…» и «+7 707…» — это два разных человека.
        index = _index(_card(FREE_CARD, "Иванов Иван", "+7 707 123 45 67"))
        for typed in ("8 707 123 45 67", "77071234567", "8(707)123-45-67", "+7 707 123 45 67"):
            with self.subTest(typed=typed):
                s = suggest_student("Иванов Иван", typed, index)
                self.assertTrue(s.auto_linkable)
                self.assertEqual(s.student_id, FREE_CARD)

    def test_taken_card_is_suggested_but_not_auto_linked(self) -> None:
        # У карточки уже есть кабинет: второй аккаунт на неё вешать нельзя,
        # но админу показать совпадение стоит — вероятно, человек завёл второй
        # Google-аккаунт.
        index = _index(_card(TAKEN_CARD, "Иванов Иван", PHONE, user_id=uuid.uuid4()))
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "card_taken")
        self.assertEqual(s.student_id, TAKEN_CARD)

    def test_duplicate_phone_never_auto_links(self) -> None:
        # Один номер на двух карточках (брат и сестра, семейный телефон).
        # fuzzy_match вернёт ту, что попалась первой, — и это ровно тот случай,
        # где «привязали к чужой» происходит без единого признака ошибки.
        index = _index(
            _card(TWIN_A, "Иванов Иван", PHONE),
            _card(TWIN_B, "Иванова Мария", PHONE),
        )
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "duplicate_phone")

    def test_name_match_alone_is_only_a_hint(self) -> None:
        # Полный тёзка — обычное дело. Пускать по имени нельзя ни при какой
        # уверенности матчинга; это подсказка админу, не решение.
        index = _index(_card(FREE_CARD, "Иванов Иван", OTHER_PHONE))
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "not_phone_exact")
        self.assertEqual(s.student_id, FREE_CARD)

    def test_no_match_leaves_no_suggestion(self) -> None:
        index = _index(_card(FREE_CARD, "Петров Пётр", OTHER_PHONE))
        s = suggest_student("Сидоров Сидор", "+7 777 999 88 77", index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "no_match")
        self.assertIsNone(s.student_id)

    def test_empty_index_is_not_a_crash(self) -> None:
        s = suggest_student("Иванов Иван", PHONE, [])
        self.assertFalse(s.auto_linkable)
        self.assertIsNone(s.student_id)


class CandidateTests(unittest.TestCase):
    """Кандидаты в очереди: все похожие карточки, а не одна первая.

    Регрессия: заявка Казимировой не показала кнопку «Привязать», админ создал
    новую карточку, дубль потом соединяли в «Рисках». Очередь обязана находить
    те же пары, что поиск дублей.
    """

    def _find(self, name: str, phone: str, *cards: dict) -> list[tuple]:
        found = find_student_candidates(name, phone, prepare_candidate_index(list(cards)))
        return [(card["id"], reason) for card, reason in found]

    def test_phone_with_8_matches_plus_7_card(self) -> None:
        found = self._find(
            "Казимирова София",
            "89068811555",
            _card(FREE_CARD, "Казимирова София Александровна2027", "+79068811555"),
        )
        self.assertEqual(found, [(FREE_CARD, "phone")])

    def test_name_with_year_suffix_and_translit(self) -> None:
        # Цифры в ФИО из таблиц и латиница в форме — всё ещё тот же человек.
        found = self._find(
            "Kazimirova Sofia",
            "+7 700 000 00 00",
            _card(FREE_CARD, "Казимирова София Александровна2027", "+79068811555"),
        )
        self.assertEqual(found, [(FREE_CARD, "name")])

    def test_taken_card_is_listed_after_free_ones(self) -> None:
        found = self._find(
            "Иванов Иван",
            PHONE,
            _card(TAKEN_CARD, "Иванов Иван", PHONE, user_id=uuid.uuid4()),
            _card(FREE_CARD, "Иванов Иван Петрович", PHONE),
        )
        self.assertEqual(found, [(FREE_CARD, "phone"), (TAKEN_CARD, "phone")])

    def test_phone_and_name_matches_are_both_shown_phone_first(self) -> None:
        found = self._find(
            "Иванов Иван",
            PHONE,
            _card(TWIN_B, "Иванов Иван", OTHER_PHONE),
            _card(TWIN_A, "Совсем Другое Имя", PHONE),
        )
        self.assertEqual(found, [(TWIN_A, "phone"), (TWIN_B, "name")])

    def test_short_phone_is_not_a_match(self) -> None:
        found = self._find("Петров Пётр", "0", _card(FREE_CARD, "Сидоров Сидор", "0"))
        self.assertEqual(found, [])

    def test_single_word_name_needs_exact_word(self) -> None:
        self.assertEqual(
            self._find("Аймин", "", _card(FREE_CARD, "Аймин", OTHER_PHONE)),
            [(FREE_CARD, "name")],
        )
        self.assertEqual(
            self._find("Аймин", "", _card(FREE_CARD, "Аймин Серикова", OTHER_PHONE)),
            [],
        )

    def test_no_candidates(self) -> None:
        found = self._find("Сидоров Сидор", "+7 777 999 88 77", _card(FREE_CARD, "Петров Пётр", OTHER_PHONE))
        self.assertEqual(found, [])


def _user(role=UserRole.student, email="new@mail.com"):
    return mock.Mock(id=uuid.uuid4(), role=role, is_active=True, email=email)


def _db(previous_owner):
    db = mock.Mock()
    db.get = mock.AsyncMock(return_value=previous_owner)
    # «Этот аккаунт уже привязан к другой карточке?» — нет.
    db.execute = mock.AsyncMock(return_value=mock.Mock(scalar_one_or_none=lambda: None))
    return db


class ReplaceExistingCabinetTests(unittest.IsolatedAsyncioTestCase):
    """Карточка с кабинетом: без явного решения — 409, с решением — перепривязка.

    Раньше у занятой карточки не было кнопки вообще, и админ заводил вторую
    карточку тому же человеку, вошедшему с другой почты.
    """

    async def _link(self, student, user, db, replace):
        with mock.patch("app.services.access_requests.record_audit"), mock.patch(
            "app.services.access_requests.revoke_all_sessions", new=mock.AsyncMock(return_value=1)
        ) as revoke:
            await link_user_to_student(
                db, student=student, user=user, actor=None, via="test", replace_existing=replace
            )
            return revoke

    async def test_taken_card_without_flag_is_conflict(self) -> None:
        old = _user(UserRole.student, "old@mail.com")
        student = mock.Mock(id=uuid.uuid4(), user_id=old.id)
        with self.assertRaises(HTTPException) as ctx:
            await self._link(student, _user(), _db(old), replace=False)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(student.user_id, old.id)

    async def test_replace_moves_card_and_disables_old_account(self) -> None:
        old = _user(UserRole.student, "old@mail.com")
        new = _user()
        student = mock.Mock(id=uuid.uuid4(), user_id=old.id)

        revoke = await self._link(student, new, _db(old), replace=True)

        self.assertEqual(student.user_id, new.id)
        self.assertEqual(new.role, UserRole.student)
        self.assertFalse(old.is_active)
        revoke.assert_awaited_once()

    async def test_staff_account_is_never_replaced(self) -> None:
        staff = _user(UserRole.mentor, "mentor@mail.com")
        student = mock.Mock(id=uuid.uuid4(), user_id=staff.id)
        with self.assertRaises(HTTPException) as ctx:
            await self._link(student, _user(), _db(staff), replace=True)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertTrue(staff.is_active)

    async def test_replace_with_self_is_explicit_refusal_and_disables_nobody(self) -> None:
        me = _user(UserRole.student, "me@mail.com")
        student = mock.Mock(id=uuid.uuid4(), user_id=me.id)
        db = _db(me)
        for replace in (False, True):
            with self.subTest(replace=replace), self.assertRaises(HTTPException) as ctx:
                revoke = await self._link(student, me, db, replace=replace)
            self.assertEqual(ctx.exception.status_code, 409)
            self.assertIn("этому же аккаунту", ctx.exception.detail)
            self.assertNotIn("другой карточке", ctx.exception.detail)
        self.assertTrue(me.is_active)
        self.assertEqual(me.role, UserRole.student)
        self.assertEqual(student.user_id, me.id)


class CloseLinkedRequestTests(unittest.IsolatedAsyncioTestCase):
    """«Закрыть заявку» у аккаунта, который уже владеет карточкой."""

    def _req(self, user):
        return mock.Mock(
            id=uuid.uuid4(), user_id=user.id, user=user, status=STATUS_NEW, requested_role="student"
        )

    def _db(self, card):
        db = mock.Mock()
        db.execute = mock.AsyncMock(
            return_value=mock.Mock(scalars=lambda: mock.Mock(first=lambda: card))
        )
        db.commit = mock.AsyncMock()
        return db

    async def _close(self, actor, req, card):
        db = self._db(card)
        with mock.patch.object(endpoints, "_load_open", new=mock.AsyncMock(return_value=req)), \
                mock.patch.object(endpoints, "record_audit") as audit:
            result = await endpoints.close_linked_request(
                req.id, mock.Mock(), actor, db
            )
        return result, audit, db

    async def test_admin_closes_own_linked_request_without_touching_account(self) -> None:
        user = _user(UserRole.student, "me@mail.com")
        card = mock.Mock(id=uuid.uuid4(), user_id=user.id)
        req = self._req(user)
        admin = _user(UserRole.admin, "admin@mail.com")

        result, audit, db = await self._close(admin, req, card)

        self.assertEqual(result["status"], STATUS_APPROVED)
        self.assertEqual(req.status, STATUS_APPROVED)
        self.assertEqual(req.decided_by, admin.id)
        self.assertTrue(user.is_active)
        self.assertEqual(user.role, UserRole.student)
        self.assertEqual(card.user_id, user.id)
        audit.assert_called_once()
        self.assertEqual(audit.call_args.kwargs["meta"]["decision"], "closed_already_linked")
        db.commit.assert_awaited_once()

    async def test_refuses_when_applicant_owns_no_card(self) -> None:
        user = _user(UserRole.student, "stranger@mail.com")
        req = self._req(user)
        with self.assertRaises(HTTPException) as ctx:
            await self._close(_user(UserRole.admin, "admin@mail.com"), req, None)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("не привязан ни к одной карточке", ctx.exception.detail)
        self.assertEqual(req.status, STATUS_NEW)

    async def test_manager_gets_403(self) -> None:
        user = _user(UserRole.student, "me@mail.com")
        card = mock.Mock(id=uuid.uuid4(), user_id=user.id)
        req = self._req(user)
        manager = mock.Mock(id=uuid.uuid4(), role=UserRole.mzk_manager, permission_grants=[])
        with self.assertRaises(HTTPException) as ctx:
            await self._close(manager, req, card)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(req.status, STATUS_NEW)

class BackfillAndReplaceQueueTests(unittest.IsolatedAsyncioTestCase):
    """Отключённый аккаунт не должен возвращаться в очередь заявок."""

    async def test_backfill_query_excludes_inactive_accounts(self) -> None:
        db = mock.Mock()
        db.execute = mock.AsyncMock(return_value=mock.Mock(all=lambda: []))
        db.flush = mock.AsyncMock()
        await backfill_unlinked_student_requests(db)
        sql = str(db.execute.await_args.args[0].compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("users.is_active IS true", sql)

    async def test_backfill_still_queues_active_student_without_card(self) -> None:
        user = mock.Mock(id=uuid.uuid4(), name="Активный", phone="+7 701 000 00 00", role=UserRole.student)
        db = mock.Mock()
        db.execute = mock.AsyncMock(return_value=mock.Mock(all=lambda: [(user, None)]))
        db.flush = mock.AsyncMock()
        created = await backfill_unlinked_student_requests(db)
        self.assertEqual(created, 1)
        added = db.add.call_args.args[0]
        self.assertEqual(added.user_id, user.id)
        self.assertEqual(added.status, STATUS_NEW)

    async def _replace(self, existing_request):
        old = _user(UserRole.student, "old@mail.com")
        old.name, old.phone = "Старый", None
        student = mock.Mock(id=uuid.uuid4(), user_id=old.id)
        db = mock.Mock()
        db.get = mock.AsyncMock(return_value=old)
        # Первый запрос — «есть ли у старого аккаунта заявка», второй — «не привязан
        # ли новый к другой карточке» (нет).
        db.execute = mock.AsyncMock(
            side_effect=[
                mock.Mock(scalar_one_or_none=lambda: existing_request),
                mock.Mock(scalar_one_or_none=lambda: None),
            ]
        )
        admin = _user(UserRole.admin, "admin@mail.com")
        with mock.patch("app.services.access_requests.record_audit"), mock.patch(
            "app.services.access_requests.revoke_all_sessions", new=mock.AsyncMock(return_value=1)
        ):
            await link_user_to_student(
                db, student=student, user=_user(), actor=admin, via="test", replace_existing=True
            )
        return old, db, admin

    async def test_replaced_account_without_request_gets_closed_marker(self) -> None:
        old, db, admin = await self._replace(existing_request=None)
        self.assertFalse(old.is_active)
        marker = db.add.call_args.args[0]
        self.assertEqual(marker.user_id, old.id)
        self.assertEqual(marker.status, "rejected")
        self.assertEqual(marker.decided_by, admin.id)

    async def test_replaced_account_with_request_is_left_alone(self) -> None:
        old, db, _ = await self._replace(existing_request=uuid.uuid4())
        self.assertFalse(old.is_active)
        db.add.assert_not_called()

    def test_candidate_has_city_and_no_email_of_its_own(self) -> None:
        card = {"id": uuid.uuid4(), "full_name": "А Б", "phone": "+7", "intake_year": 2026, "city": "Алматы", "user_id": None}
        out = endpoints._candidate_to_dict(card, "phone")
        self.assertEqual(out["city"], "Алматы")
        self.assertNotIn("email", out)

    async def test_queue_is_closed_to_roles_without_view(self) -> None:
        for role in (UserRole.student, UserRole.mentor):
            with self.subTest(role=role), self.assertRaises(HTTPException) as ctx:
                await endpoints.list_requests(
                    mock.Mock(id=uuid.uuid4(), role=role, permission_grants=[]), mock.Mock()
                )
            self.assertEqual(ctx.exception.status_code, 403)


class MentorCodeTests(unittest.TestCase):
    """Код — единственное, что отделяет ментора от очереди, поэтому «выключено»
    обязано означать «никого», а не «подходит пустая строка»."""

    def test_unset_code_lets_nobody_through(self) -> None:
        with mock.patch("app.api.v1.endpoints.public.settings") as s:
            s.JOIN_MENTOR_CODE = ""
            for attempt in ("", None, "mentors2026", " "):
                with self.subTest(attempt=attempt):
                    self.assertFalse(_mentor_code_matches(attempt))

    def test_correct_code_matches_and_others_do_not(self) -> None:
        with mock.patch("app.api.v1.endpoints.public.settings") as s:
            s.JOIN_MENTOR_CODE = "mentors2026"
            self.assertTrue(_mentor_code_matches("mentors2026"))
            for attempt in ("", None, "mentors2025", "Mentors2026", "mentors2026 "):
                with self.subTest(attempt=attempt):
                    self.assertFalse(_mentor_code_matches(attempt))


if __name__ == "__main__":
    unittest.main()
