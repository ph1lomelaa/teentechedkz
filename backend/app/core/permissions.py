"""Единый реестр прав доступа.

Зачем он существует
-------------------
До этого модуля ответить на вопрос «что может ментор?» можно было только
прочитав 40 файлов эндпоинтов: 148 инлайновых проверок роли плюс ~30 локальных
хелперов. Единого места, знающего расклад, не было — отсюда и родилась задача.

Разбор перед миграцией нашёл две вещи, из-за которых реестр обязан описывать
ФАКТИЧЕСКОЕ поведение, а не желаемое:

* `_require_staff` определён в семи файлах и имеет ТРИ разных поведения:
  в `refund_cases` и `mentor_rewards` он не пускает ментора, в остальных пяти —
  пускает. Наивное объединение молча изменило бы доступы.
* Имена функций противоречат телу: `_require_admin_mzk` в `guardians.py`,
  `contracts.py` и `mentor_assignments.py` фактически пускает ментора.

Поэтому правила ниже — слепок того, как система работает СЕЙЧАС. Места, где
поведение расходится с именем или выглядит подозрительно, помечены полем
`review` и подсвечиваются в матрице как «требует решения». Менять доступы здесь
нельзя: пока миграция не закончена, реестр обязан быть проверяемо равен старому
коду (см. tests/test_permissions_conformance.py).

Чего он НЕ решает
-----------------
Политика нераскрытия (404 вместо 403, чтобы чужой объект не подтверждал факт
своего существования) — свойство СКОУП-слоя, а не проверки роли. Отказ по роли
всегда 403; 404 отдаёт `require_student_access` в app/services/mentor_scope.py,
когда ментор лезет за пределы своих назначений. Первая версия реестра свалила
эти два слоя в одно поле `deny` и на ровном месте превратила бы часть отказов
по роли из 403 в 404 — поле убрано.

Как устроен
-----------
Чистый и без БД — копия паттерна `agreement_gate_applies` (app/core/deps.py):
данные лежат в неизменяемых структурах уровня модуля, решающие функции
принимают примитивы и возвращают решение. Ничего не await'ится, сессия сюда не
приходит. Именно это позволяет покрыть весь расклад юнит-тестами без базы —
а права ровно та поверхность, где ошибка запирает вход всем сразу.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Mapping

from fastapi import HTTPException

from app.models.user import User, UserRole


class Action(str, enum.Enum):
    """Что делают с ресурсом.

    `manage` — единое «полный доступ к разделу» для тех мест, где код не
    различает создание, правку и удаление (таких большинство: один хелпер
    закрывает весь файл). Дробить сильнее, чем дробит сам код, нельзя — матрица
    начнёт обещать то, чего в поведении нет.
    """

    view = "view"
    create = "create"
    edit = "edit"
    delete = "delete"
    manage = "manage"


class Scope(str, enum.Enum):
    """Чьи данные видны. Второй, независимый от действия, axis.

    На Этапе 1 реестр скоуп только ОПИСЫВАЕТ — фактическая фильтрация остаётся
    в `app/services/mentor_scope.py`. Причина: в системе живут два несовместимых
    определения «мои студенты» (`mentor_scope` считает только назначения,
    `workspace._workspace_student_ids` — назначения плюс договоры, где человек
    МЗК-менеджер). Сводить их — отдельное продуктовое решение, не рефакторинг.
    """

    all = "all"            # весь раздел
    assigned = "assigned"  # только назначенные студенты
    own = "own"            # только собственная запись


# Наборы ролей, встречающиеся в коде. В эндпоинтах этот же кортеж продублирован
# десять раз под пятью именами (STAFF, _STAFF, _MANAGE_ROLES, TEMPLATE_ADMIN,
# COUNTRY_EDIT_ROLES) — здесь он один.
STAFF = frozenset({UserRole.admin, UserRole.mzk_manager, UserRole.mentor})
MANAGERS = frozenset({UserRole.admin, UserRole.mzk_manager})
ADMIN = frozenset({UserRole.admin})
STAFF_AND_OWNER = STAFF | {UserRole.student}
OWNER = frozenset({UserRole.student})


@dataclass(frozen=True)
class Rule:
    """Одна клетка матрицы: кто и что может делать с ресурсом."""

    resource: str
    action: Action
    roles: frozenset[UserRole]

    #: Скоуп по ролям. Роли, которых здесь нет, получают Scope.all.
    scope: Mapping[UserRole, Scope] = field(default_factory=dict)

    #: Пункт регламента, если он реально процитирован в коде. None означает
    #: «регламентом не зафиксировано» — это тоже полезный сигнал для матрицы,
    #: поэтому выдумывать номера пунктов сюда запрещено.
    basis: str | None = None

    #: Правила, которые в матрицу не влезают (запрет самоприёмки, окна по
    #: времени, гейты по состоянию объекта, права на уровне отдельных полей).
    #: Они остаются кодом, но перестают быть невидимыми: матрица рисует на
    #: такой клетке пометку «+N доп. правил».
    extra_rules: tuple[str, ...] = ()

    #: Текст отказа, когда общий («Недостаточно прав для операции») теряет смысл.
    #: Например «Общие задачи ставит только МЗК или администратор» — человек
    #: должен понять, что именно ему запретили, а не гадать.
    denied_detail: str | None = None

    #: Значение X-Error-Code при отказе. По умолчанию общий FORBIDDEN — на него
    #: завязан фронт (client.ts:152). Своё значение ставится там, где код был
    #: заведён до реестра и служит диагностике.
    error_code: str = "FORBIDDEN"

    #: Заполнено там, где текущее поведение вызывает вопросы. Миграция ничего
    #: не меняет — она делает расхождение видимым, решение принимается отдельно.
    review: str | None = None

    #: Правило нельзя переопределить из интерфейса. Это не «важное» правило, а
    #: такое, снятие которого ломает саму возможность управлять системой: право
    #: админа на настройку прав и пользователей (иначе первый же клик отрезает
    #: вход в настройки) и кабинет ученика (он принадлежит владельцу, а не
    #: настраивается). Конструктор не рисует для них переключатель.
    locked: bool = False

    @property
    def key(self) -> tuple[str, Action]:
        return (self.resource, self.action)


_M = Action.manage
_V = Action.view
_E = Action.edit

# Повторяющиеся пометки — чтобы формулировка не разъезжалась по строкам.
_NAME_LIED = "Имя функции обещало admin+МЗК, но код пускает и ментора"
_MENTOR_SCOPED = {UserRole.mentor: Scope.assigned}
_OWNER_SCOPED = {UserRole.mentor: Scope.assigned, UserRole.student: Scope.own}


RULES: tuple[Rule, ...] = (
    # ---------------------------------------------------------------- студенты
    Rule("students", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED,
         extra_rules=(
             "Таймлайн открыт и ментору — в пределах его студентов, иначе 404 "
             "по политике нераскрытия — students.py:1081",
             "Архивные студенты скрыты от ментора — students.py:1522",
             "Опекуны и конфиденциальные заметки вырезаются из карточки по роли — students.py:1391",
             "Алерты о выплатах ментору фильтруются по роли — students.py:1469",
         )),
    Rule("students", _M, MANAGERS,
         extra_rules=("Архивация и слияние дублей — только admin+МЗК — students.py:192,275",)),

    # Заведение и правка карточки. Обе ручки не проверяли РОВНО НИЧЕГО — ни
    # роли, ни принадлежности: портальный аккаунт студента мог править чужую
    # карточку (ФИО, телефон, GPA, бюджет) прямым вызовом API. Дыра старше
    # миграции: слепок Этапа 1 сверял «до» и «после», а не «правильно ли».
    #
    # Решение 30.08.2026: заводит и правит персонал; ментор — только своих
    # студентов, студенту закрыто.
    Rule("students", Action.create, STAFF,
         extra_rules=("Дубль по телефону отбивается 409 с X-Existing-Id — students.py:975",)),
    Rule("students", Action.edit, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=(
             "Ментор правит только своих: require_student_access отдаёт 404 на "
             "чужого — students.py:1489",
             "Правка полей пишется в историю изменений — students.py:1505",
         )),

    Rule("guardians", _M, STAFF, scope=_MENTOR_SCOPED,
         review=_NAME_LIED + ". Ресурс содержит ПДн родителей, включая ИИН",
         extra_rules=("Раскрытие ИИН отдельно ограничено admin+МЗК — StudentCardPage.tsx:1585",)),

    Rule("emergency_contacts", _M, STAFF, scope=_MENTOR_SCOPED,
         basis="Регламент МЗК п.3.2, п.3.4"),

    # Зоны ответственности: кто ведёт встречи, Telegram, заметки, задачи и т.д.
    # у конкретного ученика. Видят все сотрудники — в этом весь смысл: раздел
    # заведён ровно затем, чтобы перестать гадать, чей это участок. Раздаёт
    # админ и МЗК-менеджер.
    #
    # Ответственность НЕ ограничивает доступ: она не решает, кому можно, — это
    # дело правил выше. См. докстринг models/student_responsibility.py.
    Rule("responsibilities", _V, STAFF, scope=_MENTOR_SCOPED),
    Rule("responsibilities", _M, MANAGERS,
         extra_rules=(
             "Один ответственный на зону — уникальность в схеме: "
             "student_responsibility.py:62",
         )),

    Rule("confidential_notes", _M, STAFF, scope=_MENTOR_SCOPED,
         review="Ментор допущен к конфиденциальным заметкам — проверить, так ли задумано",
         extra_rules=(
             "Видимость каждой заметки решает note_visible_to_role: admin_only / "
             "admin_and_mzk / all_mentors — confidential_note.py:17",
         )),

    Rule("student_access", _M, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=("Сброс пароля завершает все сессии студента — student_access.py:285",)),

    # Решение 30.08.2026: ментор подтягивает коллег на своего ученика сам.
    # Имя старой функции обещало admin+МЗК, но код пускал ментора; теперь это
    # осознанный доступ, а не расхождение.
    Rule("mentor_assignments", _M, STAFF,
         extra_rules=(
             "Назначить можно только ментора или МЗК-менеджера — mentor_assignments.py:156",
             "Замена специалиста требует указания причины — mentor_assignments.py:169",
             "Назначение исполнителю с неподписанным регламентом уходит в "
             "awaiting_signature — mentor_assignments.py:96",
         )),

    # ---------------------------------------------------------------- финансы
    Rule("finances", _V, STAFF,
         review="Ментор видит финансы целиком — решение продукта, зафиксировано в payments.py:28"),
    Rule("finances", _M, MANAGERS),

    # Решение 30.08.2026: раздел «Договор» ментор видит (он ведёт ученика и
    # должен знать условия), а суммы и даты правит только управление. До этого
    # одно право отвечало за оба вопроса, и API пускал ментора на правку.
    Rule("contracts", _V, STAFF),
    Rule("contracts", _M, MANAGERS),
    Rule("contract_addenda", _V, STAFF_AND_OWNER,
         extra_rules=("Студент видит только свои допсоглашения — contract_addenda.py:76",)),
    Rule("contract_addenda", _M, MANAGERS,
         extra_rules=(
             "Подписать «за клиента» может студент-владелец либо admin/МЗК от его имени, "
             "и только пока статус draft или sent_to_customer — contract_addenda.py:162",
         )),
    # Утверждение кейса и отметка о выплате бонуса — только admin (refund_cases.py:135,256).
    Rule("refund_approval", _M, ADMIN),
    Rule("refund_cases", _M, MANAGERS, basis="п.6.8, п.6.9",
         extra_rules=(
             "Утверждение и отметка о выплате бонуса — только admin — refund_cases.py:139,260",
             "МЗК не вправе поднять уровень после решения кейса (п.6.9) — refund_cases.py:180",
             "Смена утверждённого уровня требует причины и письменного согласования "
             "в теле запроса — refund_cases.py:37",
         )),

    # ---------------------------------------------------------------- задачи
    Rule("tasks", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED),
    Rule("tasks", _M, STAFF, scope=_MENTOR_SCOPED,
         basis="Прил. № 3, п. 3.4",
         extra_rules=(
             "Принять собственный результат нельзя никому — tasks.py:43",
             "Общие задачи (без студента) ставит только admin/МЗК — tasks.py:182",
             "Одна PATCH применяет разные правила к разным полям: result_text — "
             "исполнителю или admin/МЗК, review_note — только admin/МЗК — tasks.py:395",
             "Требуемое право зависит от роли НАЗНАЧАЕМОГО: assign_mentor_tasks "
             "либо assign_mzk_tasks — tasks.py:196",
             "Приёмка блокируется, пока не приложены все required_documents — tasks.py:455",
             "Задача исполнителю с неподписанным регламентом уходит в "
             "awaiting_signature — tasks.py:211",
         )),

    # Задача без привязки к студенту («сдай отчёт», «пройди обучение»):
    # отдельная возможность, ментору недоступна — tasks.py:182.
    Rule("tasks_general", _M, MANAGERS,
         denied_detail="Общие задачи ставит только МЗК или администратор",
         error_code="GENERAL_TASK_FORBIDDEN"),
    # Массовая постановка задач сразу многим — tasks.py:303.
    Rule("tasks_bulk", _M, MANAGERS,
         denied_detail="Массовое назначение доступно МЗК и администратору",
         error_code="BULK_ASSIGN_FORBIDDEN"),
    # Поля проверки: комментарий ревьюера и правка чужого результата — tasks.py:395,399.
    Rule("tasks_review", _M, MANAGERS,
         extra_rules=(
             "Свой результат исполнитель правит и без этого права — tasks.py:395",
         )),

    # Операционные права: не «доступ к разделу», а «позволено ли само действие
    # внутри задач». Жили отдельной системой в deps.PERMISSIONS — во фронт не
    # ехали, в матрице не показывались, из-за чего два места в карточке ученика
    # невозможно было перевести на can(). Роли перенесены один в один из
    # ROLE_PERMISSIONS; error_code сохранён, чтобы не менять контракт ответа.
    Rule("tasks_assign_mentor", _M, MANAGERS, error_code="PERMISSION_REQUIRED",
         denied_detail="Недостаточно прав для операции",
         extra_rules=("Право выбирается по роли НАЗНАЧАЕМОГО, а не вызывающего — tasks.py:191",)),
    Rule("tasks_assign_mzk", _M, MANAGERS, error_code="PERMISSION_REQUIRED",
         denied_detail="Недостаточно прав для операции"),
    Rule("tasks_accept_result", _M, MANAGERS, error_code="PERMISSION_REQUIRED",
         denied_detail="Недостаточно прав для операции",
         extra_rules=("Принять собственный результат нельзя никому — tasks.py:43",)),
    Rule("tasks_deadlines", _M, STAFF, error_code="PERMISSION_REQUIRED",
         denied_detail="Недостаточно прав для операции"),

    Rule("checkins", _V, MANAGERS,
         extra_rules=("Отмечаться обязаны только ментор и МЗК — services/checkins.py:16",)),

    # ---------------------------------------------------------------- контент
    Rule("documents", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED,
         basis="Регламент МЗК п.2.2, п.3.5-3.6",
         extra_rules=(
             "Студент видит документ только при visible_to_student — documents.py:228",
             "Запрос подписи сам выставляет visible_to_student — documents.py:322",
         )),
    Rule("documents", _M, STAFF, scope=_MENTOR_SCOPED),

    Rule("notes", _M, STAFF, scope=_MENTOR_SCOPED),
    Rule("note_sessions", _M, STAFF, scope=_MENTOR_SCOPED),
    Rule("communication", _M, STAFF, scope=_MENTOR_SCOPED),
    Rule("portfolio", _M, STAFF,
         review="_check_access принимает student_id и не проверяет его — portfolio.py:103"),
    Rule("services", _M, STAFF, scope=_MENTOR_SCOPED),
    Rule("applications", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED),
    Rule("applications", _M, STAFF, scope=_MENTOR_SCOPED),
    Rule("credentials", _M, STAFF_AND_OWNER, scope=_OWNER_SCOPED),
    Rule("student_universities", _M, STAFF_AND_OWNER, scope=_OWNER_SCOPED),
    Rule("questionnaires", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED),
    Rule("questionnaires", _M, STAFF, scope=_MENTOR_SCOPED),
    Rule("meetings", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED),
    Rule("meetings", _M, STAFF, scope=_MENTOR_SCOPED),

    Rule("roadmaps", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED,
         extra_rules=(
             "Скрытые этапы и задачи вырезаются из ответа студенту — roadmaps.py:1018",
         )),
    Rule("roadmaps", _E, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=(
             "Этап нельзя начать, пока обязательная команда не допущена — roadmaps.py:721",
             "Студент отмечает свою задачу сам, но только пока роадмап active — roadmaps.py:891",
             "Ревью задачи возможно только из статуса pending — roadmaps.py:608",
         )),
    # Решение 30.08.2026: ментор ведёт roadmap ученика и меняет шаблоны сам.
    # Константа названа TEMPLATE_ADMIN, но всегда включала ментора — расхождение
    # разрешено в пользу текущего поведения.
    Rule("roadmap_templates", _M, STAFF),
    Rule("roadmap_templates", Action.create, ADMIN,
         extra_rules=("Импорт шаблонов из Notion — только admin — roadmaps.py:104",)),

    # ---------------------------------------------------------------- общение
    Rule("chat", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED,
         extra_rules=(
             "Не-участник видит переписку, только если он сотрудник И в беседе есть "
             "студент: переписка сотрудников между собой закрыта — chat.py:124",
             "Ментор не может смотреть инбокс другого ментора, admin/МЗК могут — chat.py:199",
         )),
    Rule("chat", _M, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=("Открыть чат со студентом можно только в своём скоупе — chat.py:287",)),

    Rule("telegram_chats", _V, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=(
             "Ментор видит только созданные им коды привязки — telegram_chats.py:108",
         )),
    Rule("telegram_chats", _M, MANAGERS,
         extra_rules=("Публикация в группу — только admin+МЗК — telegram_chats.py:191",)),

    Rule("complaints", _V, STAFF_AND_OWNER, scope=_OWNER_SCOPED,
         basis="Прил. № 3, п. 2.1",
         extra_rules=(
             "Автор и назначенный видят обращение независимо от роли — complaints.py:118",
             "Иначе решает note_visible_to_role — тот же предикат, что у заметок "
             "— confidential_note.py:17",
             "SQL-запрос списка повторяет этот предикат руками — complaints.py:163",
             "Ответы фильтруются по visible_to_author внутри уже открытого обращения "
             "— complaints.py:113",
         )),
    Rule("complaints", _M, MANAGERS, basis="п. 1.3.4"),

    # ---------------------------------------------------------------- мотивация
    Rule("mentor_rewards", _V, STAFF, basis="п.7.1",
         scope={UserRole.mentor: Scope.own},
         extra_rules=(
             "Ментор оспаривает только своё взыскание и только 2 рабочих дня "
             "с момента фиксации (п.6.8); сотрудник — без ограничения по сроку "
             "— mentor_rewards.py:64,326",
         )),
    Rule("mentor_rewards", _M, MANAGERS, basis="п.6.2, п.6.7-6.9"),
    # 30.08.2026: было STAFF. Ментора здесь не было никогда — `resolve_score_scope`
    # отдаёт ему 403 с самого начала, и это осознанно: баллы ОКК — оценка работы
    # сотрудника. Правило обещало доступ, которого в коде нет, и это вскрылось,
    # когда роут `/mzk-quality` перевели на ключ меню: ментор доходил до
    # страницы и получал пустой экран с 403 в консоли.
    Rule("mzk_quality", _V, MANAGERS, basis="п.7.4, п.7.5",
         scope={UserRole.mzk_manager: Scope.own},
         extra_rules=(
             "Запрошенный manager_id у МЗК молча подменяется своим, а не отвергается "
             "— mzk_quality.py:36",
             "Возражение подаёт только сам МЗК, до утверждения и до дедлайна "
             "— mzk_quality.py:243",
             "Самооценка и повторные оценки недействительны (п.7.8) — mzk_quality.py:288",
         )),
    Rule("mzk_quality", _M, ADMIN, basis="п.7.8"),
    Rule("reward_rules", _V, STAFF),
    Rule("reward_rules", _M, ADMIN),

    # ---------------------------------------------------------------- справочники
    Rule("universities", _V, STAFF_AND_OWNER,
         review="Чтение не проверяет роль вообще — доступно любому вошедшему "
                "(включая студента) — universities.py:46"),
    Rule("universities", _M, MANAGERS,
         review="Константа названа ADMIN, но включает МЗК — universities.py:36"),
    # Импорт справочника вузов из внешнего источника — переписывает каталог целиком.
    Rule("universities", Action.create, ADMIN),
    Rule("countries", _V, STAFF_AND_OWNER,
         review="Чтение не проверяет роль вообще — countries.py:35"),
    # Решение 30.08.2026: справочник общий для всех учеников, случайная правка
    # задевает всех — редактирует только управление. API пускал и ментора.
    Rule("countries", _E, MANAGERS),
    Rule("scholarships", _M, STAFF,
         review="Докстринг обещает «Admin/mzk_manager only», код пускает ментора "
                "— scholarships.py:18,59"),
    Rule("knowledge", _V, STAFF),
    Rule("knowledge", _M, ADMIN,
         extra_rules=("Синхронизация с Notion и статус джобы — только admin — knowledge.py:79,109",),
         review="Константа _MANAGE_ROLES объявлена и не используется ни разу "
                "— knowledge.py:25"),

    # ---------------------------------------------------------------- интеграции
    Rule("sync", _M, STAFF,
         extra_rules=("Запуск синхронизации вынесен в отдельное правило sync/create — sync.py:63",)),
    # Ручной запуск синхронизации: тянет внешние источники и переписывает данные,
    # поэтому уже: только admin (sync.py:63).
    Rule("sync", Action.create, ADMIN),
    Rule("notion", _M, STAFF,
         extra_rules=("Ручной запуск вынесен в отдельное правило notion/create — notion.py:209",)),
    Rule("notion", Action.create, ADMIN),
    Rule("export", _M, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=("Отдельный лист выгрузки скрыт по роли — services/excel_export.py:113",)),

    Rule("status_history", _V, STAFF),
    # Токен Deepgram для распознавания речи в браузере — status_history.py рядом,
    # но ресурс отдельный: выдаётся сотрудникам, не студентам.
    Rule("integrations", _M, STAFF),

    # ---------------------------------------------------------------- админское
    Rule("users", _V, STAFF),
    Rule("users", _M, ADMIN, locked=True),
    Rule("audit", _V, ADMIN),

    # Матрица прав и её редактирование. Заперты оба: сняв это право, админ
    # отрезал бы себе вход в настройки — и вернуть его было бы уже нечем.
    Rule("permissions", _V, ADMIN, locked=True),
    Rule("permissions", _M, ADMIN, locked=True,
         extra_rules=("Запертые правила переключать нельзя — permissions.py:452",)),
    Rule("agreements", _V, STAFF_AND_OWNER,
         extra_rules=(
             "Скачать можно только опубликованный регламент своей аудитории; "
             "admin видит и черновики — agreements.py:52",
         )),
    Rule("agreements", _M, ADMIN),
    Rule("security_incidents", _M, MANAGERS),

    # Разделы личного кабинета: только студент. Проверка была продублирована
    # четырнадцать раз в десяти файлах — теперь одно правило.
    Rule("portal", _V, OWNER, locked=True),

    # ---------------------------------------------------------------- рабочий стол
    Rule("workspace", _V, STAFF, scope=_MENTOR_SCOPED,
         extra_rules=(
             "admin/МЗК могут смотреть глазами конкретного ментора через ?mentor_id, "
             "ментор — только своими — workspace.py:63",
             "«Мои студенты» здесь считаются иначе, чем в mentor_scope: назначения "
             "ПЛЮС договоры, где человек МЗК-менеджер — workspace.py:56",
         )),
)


# Ресурсы, у которых обязаны быть заполнены extra_rules. Список зафиксирован
# тестом: без него достаточно случайно стереть заметку — и матрица начнёт
# показывать неполную правду, ничем этого не выдав.
CONDITIONAL_RESOURCES = frozenset({
    "tasks", "agreements", "complaints", "refund_cases", "mentor_rewards",
    "mzk_quality", "roadmaps", "chat", "telegram_chats", "documents",
    "workspace", "contract_addenda", "students", "confidential_notes",
})


_BY_KEY: dict[tuple[str, Action], Rule] = {r.key: r for r in RULES}

# Переопределения состава ролей, заданные админом в конструкторе.
#
# Реестр выше остаётся ДЕФОЛТОМ и списком допустимого: база может изменить
# только набор ролей у уже описанного правила. Пары, которой здесь нет, из базы
# не появится — иначе переименование ресурса оставляло бы висеть правило-призрак,
# который никто не проверяет.
#
# Модуль по-прежнему не знает про БД: словарь заполняет
# `app/services/permission_overrides.py`, который его сюда и приносит. Это то же
# разделение, что у `agreement_gate_applies`: решение — чистое, поход в базу —
# снаружи.
_OVERRIDES: dict[tuple[str, Action], frozenset[UserRole]] = {}


def set_overrides(overrides: Mapping[tuple[str, Action], frozenset[UserRole]]) -> None:
    """Заменить все переопределения разом.

    Именно заменить, а не дополнить: частичное обновление оставляло бы снятое
    в базе правило действовать в памяти до перезапуска.

    Запертые правила (`Rule.locked`) игнорируются молча — они защищают саму
    возможность управлять системой, и обойти их через слой данных нельзя.
    """
    _OVERRIDES.clear()
    for key, roles in overrides.items():
        rule = _BY_KEY.get(key)
        if rule is None or rule.locked:
            continue
        _OVERRIDES[key] = frozenset(roles)


def overrides() -> Mapping[tuple[str, Action], frozenset[UserRole]]:
    """Что сейчас переопределено — для матрицы и диагностики."""
    return dict(_OVERRIDES)


def _roles_for(key: tuple[str, Action]) -> frozenset[UserRole] | None:
    """Действующий состав ролей: переопределение, иначе значение из кода."""
    if key in _OVERRIDES:
        return _OVERRIDES[key]
    rule = _BY_KEY.get(key)
    return rule.roles if rule else None


def rule_for(resource: str, action: Action) -> Rule | None:
    """Правило или None, если пара (ресурс, действие) не описана."""
    return _BY_KEY.get((resource, action))


def allows(*, resource: str, action: Action, role: UserRole) -> bool:
    """Пускает ли реестр эту роль. Чистая функция — основа всех тестов.

    Неописанная пара (ресурс, действие) — это отказ, а не разрешение: реестр,
    молчаливо пропускающий незнакомое, бесполезен как гарантия.
    """
    roles = _roles_for((resource, action))
    return bool(roles is not None and role in roles)


def scope_for(*, resource: str, action: Action, role: UserRole) -> Scope:
    """Какой объём данных положен этой роли. По умолчанию — весь раздел."""
    rule = _BY_KEY.get((resource, action))
    if rule is None:
        return Scope.all
    return rule.scope.get(role, Scope.all)


def require_access(user: User, resource: str, action: Action) -> None:
    """Проверить право или отказать в форме, заданной правилом.

    Тонкая обёртка над `allows`: вся логика решения остаётся чистой и
    тестируемой, здесь только перевод «нет» в HTTP-ответ.
    """
    rule = _BY_KEY.get((resource, action))
    if rule is None:
        raise HTTPException(
            status_code=403,
            detail="Доступ не описан в реестре прав",
            headers={"X-Error-Code": "PERMISSION_UNDEFINED"},
        )
    if user.role in (_roles_for((resource, action)) or frozenset()):
        return
    # Код по умолчанию FORBIDDEN, а не PERMISSION_REQUIRED: это общая конвенция
    # отказа по роли (deps.require_roles, universities._FORBIDDEN и др.), и на неё
    # завязан фронт — client.ts:152 по этому заголовку перечитывает профиль,
    # когда админ поменял роль в открытой вкладке. Пока маскировка 403 стирала
    # заголовки, разницы не было; теперь она есть.
    raise HTTPException(
        status_code=403,
        detail=rule.denied_detail or "Недостаточно прав для операции",
        headers={"X-Error-Code": rule.error_code},
    )


def allowed_roles(resource: str, action: Action) -> frozenset[UserRole] | None:
    """Действующий состав ролей: с учётом переопределения из конструктора.

    `Rule.roles` — это значение из кода, то есть дефолт. Для показа и для
    записи в историю нужно то, что действует сейчас.
    """
    return _roles_for((resource, action))


def all_rules() -> tuple[Rule, ...]:
    """Весь реестр — для эндпоинта матрицы."""
    return RULES


def granted_for(role: UserRole) -> tuple[str, ...]:
    """Права роли в виде «ресурс:действие» — то, что уезжает во фронт.

    Плоский список строк, а не дерево: на той стороне вопрос всегда один и тот
    же — «можно ли roleX сделать action с resource», и `Set.has()` отвечает на
    него без обхода структуры.

    Скоуп сюда НЕ попадает намеренно. Фронт, умеющий фильтровать по скоупу,
    стал бы вторым местом, где решается объём выдачи, — а фильтрация живёт в
    `app/services/mentor_scope.py` и обязана оставаться одна. Права здесь нужны
    для меню и роутов: показать раздел или нет.
    """
    # Через `_roles_for`, а не `rule.roles`: состав ролей может быть переопределён
    # конструктором прав. Читая статический реестр напрямую, payload разошёлся бы
    # с ответом `allows()` — меню показывало бы раздел, который эндпоинт закрыл,
    # и прятало бы тот, который открыт.
    return tuple(
        f"{rule.resource}:{rule.action.value}"
        for rule in RULES
        if role in (_roles_for(rule.key) or frozenset())
    )


def resources() -> tuple[str, ...]:
    """Ресурсы в порядке объявления, без повторов."""
    seen: dict[str, None] = {}
    for rule in RULES:
        seen.setdefault(rule.resource, None)
    return tuple(seen)
