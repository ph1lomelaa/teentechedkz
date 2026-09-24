"""В какой роли сотрудник оказывается у студента — и кого вообще предлагают.

Ради чего тест
--------------
МЗК-менеджер пожаловалась на две вещи сразу: «когда беру студентов,
высвечиваюсь как ментор по УП» и «меня нет в списке, чтобы назначить меня МЗК».
Причины оказались разными, и обе — в том, что роль в команде ученика выводилась
из учётной роли (`users.role`), а не из того, кем человек работает
(`users.mentor_specialties`).

1. Всё, что не `mzk_manager`, молча становилось `lead`. Профориентолог,
   заводивший студенту встречу, получал вторую строку «Ментор по УП» — без
   причины и без записи в истории замен.
2. Список «кого назначить на МЗК» фильтровался по `users.role == mzk_manager`,
   поэтому человек с учётной ролью «Ментор», работающий МЗК, не показывался в
   нём вообще — хотя назначить его бэкенд разрешал.

Здесь проверяются обе развязки. БД нет (фикстур с ней в проекте нет):
`default_assignment_role` чистая, а от `candidates_query` смотрим условия
собранного SQL.
"""
import unittest
import uuid

from app.models.mentor_assignment import ASSIGNABLE_ROLES, MentorRole
from app.models.user import User, UserRole
from app.services.assignment_candidates import candidates_query, staff_role_for
from app.services.mentor_scope import default_assignment_role


def _user(role: UserRole, specialties: list[str] | None = None) -> User:
    return User(id=uuid.uuid4(), name="Сотрудник", role=role, mentor_specialties=specialties or [])


class DefaultAssignmentRoleTests(unittest.TestCase):
    def test_mzk_manager_becomes_mzk(self) -> None:
        # Регресс, который и завёл это правило: менеджер МЗК, нажавший «Взять в
        # работу», становился ментором по УП.
        self.assertEqual(default_assignment_role(_user(UserRole.mzk_manager)), MentorRole.mzk)

    def test_the_single_specialty_wins(self) -> None:
        # Главный фикс: профориентолог встаёт профориентологом, а не «ментором
        # по УП» просто потому, что у него учётная роль mentor.
        user = _user(UserRole.mentor, ["career"])
        self.assertEqual(default_assignment_role(user), MentorRole.career)

    def test_a_mentor_working_as_mzk_becomes_mzk(self) -> None:
        # Ровно случай из жалобы: человек ведёт МЗК, а в учётке у него «Ментор».
        user = _user(UserRole.mentor, ["mzk"])
        self.assertEqual(default_assignment_role(user), MentorRole.mzk)

    def test_several_specialties_fall_back_instead_of_guessing(self) -> None:
        # Угадывать нельзя: человек ведёт и IELTS, и страну, и выбрать за него
        # значило бы снова записать роль, которую он не выбирал. Правильную
        # ставят руками в «Команде ученика».
        user = _user(UserRole.mentor, ["ielts", "country"])
        self.assertEqual(default_assignment_role(user), MentorRole.lead)

    def test_no_specialty_falls_back(self) -> None:
        # Специализации заполняются руками и у большинства ещё пустые —
        # поведение до их появления должно остаться прежним.
        self.assertEqual(default_assignment_role(_user(UserRole.mentor)), MentorRole.lead)

    def test_a_specialty_outside_the_assignable_list_is_ignored(self) -> None:
        # MentorRole шире назначаемых ролей: 'sat' остался в старых данных, но
        # роли в команде ученика у него нет.
        user = _user(UserRole.mentor, ["sat"])
        self.assertEqual(default_assignment_role(user), MentorRole.lead)

    def test_the_mzk_role_never_lands_on_a_plain_mentor_by_accident(self) -> None:
        # Каждая назначаемая роль достижима через специализацию — иначе
        # проставить её в настройках было бы бессмысленно.
        for role in ASSIGNABLE_ROLES:
            with self.subTest(role=role.value):
                self.assertEqual(default_assignment_role(_user(UserRole.mentor, [role.value])), role)


class CandidatesQueryTests(unittest.TestCase):
    """Кого показывать в списке «кого назначить»."""

    @staticmethod
    def _sql(role: MentorRole) -> str:
        return str(candidates_query(role).compile(compile_kwargs={"literal_binds": True}))

    def test_mzk_is_sourced_from_managers(self) -> None:
        self.assertEqual(staff_role_for(MentorRole.mzk), UserRole.mzk_manager)

    def test_every_other_role_is_sourced_from_mentors(self) -> None:
        for role in (MentorRole.lead, MentorRole.career, MentorRole.ielts, MentorRole.country):
            with self.subTest(role=role.value):
                self.assertEqual(staff_role_for(role), UserRole.mentor)

    def test_the_specialty_is_an_alternative_to_the_account_role(self) -> None:
        # Ключевая развязка: условия соединены через OR. Пока это был AND
        # (так фильтровала доска) или только `users.role` (так фильтровала
        # выпадашка), ментор со специализацией МЗК не попадал никуда.
        sql = self._sql(MentorRole.mzk)
        self.assertIn("mentor_specialties", sql)
        self.assertIn("OR", sql)

    def test_inactive_staff_are_never_offered(self) -> None:
        # Уволенного предлагать к назначению нельзя. В уже существующих
        # назначениях он остаётся виден — те читаются из responsibles.
        self.assertIn("is_active", self._sql(MentorRole.lead))

    def test_admins_are_offered_too(self) -> None:
        # Бэкенд их назначать разрешает (_load_assignable_mentor), а выпадашка
        # не показывала — список обещал меньше, чем система умеет.
        self.assertIn("admin", self._sql(MentorRole.career))
