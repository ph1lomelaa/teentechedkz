# Централизация прав доступа

Ветка: `feat/permissions-registry`. В `main` не мержить, пока не пройдёт ревью —
CI на пуш в `main` пересобирает и деплоит прод.

Статус на 29.08.2026: **Этап 1 закрыт**, Этап 2 не начат.

---

## Зачем

Никто не мог ответить, что именно может каждая роль. Это не ощущение, а свойство
кода: единого места, отвечающего на этот вопрос, не существовало.

Что нашли при разборе:

- **148** инлайновых проверок роли в ~40 файлах эндпоинтов, ~**30** локальных хелперов.
- **`_require_staff` был определён в 7 файлах и имел три разных поведения.**
  `refund_cases.py` и `mentor_rewards.py` пускали только {admin, mzk};
  `export.py`, `confidential_notes.py`, `communication.py`, `emergency_contacts.py`
  пускали ещё и ментора с голым 403; `workspace.py` — ментора с `X-Error-Code`.
  Наивное объединение молча изменило бы доступы.
- **Имена функций противоречили телу.** `_require_admin_mzk` в `guardians.py`,
  `mentor_assignments.py`, `contracts.py` фактически пускал **ментора** — включая
  данные опекунов (ИИН родителей) и конфиденциальные заметки. `_assert_admin` в
  `universities.py` пускал МЗК. В `scholarships.py` докстринг говорил
  «Admin/mzk_manager only», а код пускал ментора.
- **10 копий** кортежа `(admin, mzk_manager, mentor)` под 5 разными именами.
- Реестр в `deps.py` был практически мёртв: `require_permission` вызывался в 5 местах,
  все в `tasks.py`; `AdminOrMZK` и `StudentOnly` — нигде.
- Фронт: `canAccess` в `contexts/AuthContext.tsx` — **4 ветки из 6 возвращают `true`
  кому угодно**, включая `confidential` и `guardians`.
- **Навигация и роуты расходятся:** `/workspace/security-incidents` скрыт из меню для
  ментора, но роут пускает любого сотрудника по прямой ссылке. У `/dashboard`,
  `/students`, `/finances` роль не проверяется вообще.

## Принятые решения

1. **Миграция не меняет ни одного доступа.** Расхождения выше переносятся как есть и
   помечаются полем `review`. Решение по ним принимается отдельно, глядя на готовую
   матрицу. Иначе рефакторинг перестаёт быть проверяемым.
2. **Скоуп на Этапе 1 только описывается, не применяется.** Реестр записывает, у кого
   какой скоуп (`all` / `assigned` / `own`), фактическая фильтрация остаётся в
   `services/mentor_scope.py`.
3. **Редактируемость (Этап 3) не делаем.** Ни таблиц в БД, ни ручек в UI.

---

## Как доказывается, что доступы не поехали

Три независимых уровня. Главный — первый.

1. **Эмпирический слепок.** Одноразовая локальная БД + `app.core.seed_demo`, затем
   988 проб: 4 роли × все эндпоинты × GET/POST/PATCH, до и после. Прогонялся 5 раз
   по ходу миграции, **всегда 0 расхождений**.
2. **`test_permissions_expected.py`** — явная таблица «ресурс × действие → роли»,
   снятая с фактического поведения. Любая правка доступа валит тест.
3. **`test_permissions_wiring.py`** — `inspect.getsource`: эндпоинт обязан звать
   реестр, старой проверки не осталось, новые самодельные `_require_*` не заводятся.

---

## Этап 1 — реестр ✅

**`backend/app/core/permissions.py`** — чистый, без БД. 74 правила, 50 ресурсов.

```
Action  = view | create | edit | delete | manage
Scope   = all | assigned | own
Rule(resource, action, roles, scope, basis, extra_rules, denied_detail, error_code, review)
```

Публичное API: `allows()`, `scope_for()`, `require_access()`, `rule_for()`,
`all_rules()`, `resources()`. Неизвестная пара «ресурс + действие» = **запрет**.

Отказ по роли **всегда 403**. 404 (политика нераскрытия) отдаёт слой скоупа
(`require_student_access`), а не реестр — поле `deny` из черновика убрано намеренно.

`X-Error-Code` по умолчанию `FORBIDDEN` — на него завязан `frontend/src/api/client.ts`.

**22 правила не выражаются через «роль × действие × скоуп»** (запрет принимать
собственный результат; PATCH, применяющий 4 разных правила к 4 полям тела;
требуемое право, зависящее от роли *другого* пользователя; окна оспаривания по
времени). Они остались кодом, но перестали быть невидимыми: каждое записано строкой
в `extra_rules` с указателем на файл и строку. Тест следит, что указатель настоящий.

### Результат

| | было | стало |
|---|---|---|
| Самодельных гейтов | 40 | 21 — и ни один не решает по роли |
| Проверок `current_user.role` | 148 | 82 |
| Сравнений роли с набором | ~60 | **10** |
| Вызовов реестра | 0 | 207 |
| Тестов | 342 | 390 |

**Оставшиеся 10 сравнений — не долг.** Ни одно не является проверкой прав
вызывающего:

| Где | Что на самом деле |
|---|---|
| `tasks.py:189,408`, `mentor_assignments.py:152,248` | валидация роли **назначаемого** |
| `students.py:1377,1396,1474` | фильтрация выдачи, а не отказ |
| `students.py:1078` | скоуп: ментор получает 404 на чужого студента |
| `complaints.py:419` | флаг `is_staff_reply` для расчёта SLA |
| `contract_addenda.py:159` | составное правило «подписывает заказчик или персонал от его имени» |

### Осталось от Этапа 1

- [ ] Чистка мёртвого в `deps.py`: `AdminOrMZK`, `StudentOnly`, права
      `manage_users` и `manage_regulations` — ноль вызовов.

---

## Этап 2 — матрица и фронт

Порядок важен: **страница идёт после подключения.** Матрица поверх неподключённого
реестра показывала бы красивую неправду. Wiring-тест гарантирует, что реестр и есть
поведение, — тогда матрица истинна по построению.

- [ ] **2.1** `GET /api/v1/permissions/matrix`, только админ (`AdminOnly` из `deps.py`).
      Отдаёт сериализованный реестр: ресурсы, действия, роли, скоуп, `basis`,
      `extra_rules`, пометки `review`.
- [ ] **2.2** Страница `/settings/permissions`, только админ. Конвенции копируем у
      `frontend/src/pages/SettingsUsersPage.tsx`: `PageHeader`, ряд `StatCard`
      (`colorPrefix="p"`), shadcn `Table` в обёртке `border-y border-p-line`.
      Строки — ресурс × действие, колонки — четыре роли. Ячейка: ✓ / — плюс метка
      скоупа, пометки «+N доп. правил» и «требует решения». Только чтение —
      переключателя в `components/ui/` и нет.
- [ ] **2.3** Права доезжают до фронта **во всех трёх формах payload**, иначе разъедутся:
      `GET /auth/me`, `LoginResponse.user` (`services/sessions.py`), результат принятия
      инвайта. Собирать **одной общей функцией**.
- [ ] **2.4** `AuthContext.can(resource, action)`. **`canAccess` удаляется** — она
      сломана. Её 12 вызовов переезжают на `can()`. `hasRole` остаётся только там,
      где вопрос про личность роли («я студент?»). Правим ~68 верхнеуровневых
      вычислений; ниже они идут пропсами в ~172 места — те не трогаем.
- [ ] **2.5** `NavItem.permission` во все три шелла (`components/shared/Layout.tsx`,
      `layouts/WorkspaceLayout.tsx`, `components/portal/StudentPortalLayout.tsx`),
      фильтрация через `can()`. `ProtectedRoute` в `App.tsx` читает **тот же ключ**
      вместо пропа `roles`. Это закрывает дыру с `/workspace/security-incidents`.
- [ ] **CI** `backend/tests/e2e_workspace_roles.py` — готовый HTTP-прогон матрицы по
      четырём ролям, но `pytest.ini` собирает только `test_*.py`, поэтому в CI он не
      запускается. Добавить в `.github/workflows/deploy.yml` рядом с
      `e2e_auth_intake.py` — uvicorn там уже поднимается, нужна одна строка.

---

## 12 расхождений, помеченных `review`

Перенесены как есть, **не исправлены** — это осознанное решение, а не забывчивость.
Решать, глядя на готовую матрицу (Этап 2). Каждое живёт в `Rule.review`:

- ментор достаёт опекунов (ИИН родителей) и конфиденциальные заметки;
- `_require_admin_mzk` фактически пускал ментора в `guardians`, `contracts`,
  `mentor_assignments`;
- константа `TEMPLATE_ADMIN` включает ментора; константа `ADMIN` в `universities`
  включает МЗК;
- докстринг `scholarships` обещает admin+МЗК, код пускает ментора;
- чтение справочников `universities` и `countries` **не проверяет роль вообще**;
- `portfolio._check_access` принимает `student_id` и не проверяет его.

---

## Команды

Прогонять из корня репозитория.

```bash
# Тесты бэка — основная проверка. Ожидается 390 passed.
cd backend && ../.venv/bin/python -m pytest -q; cd ..

# Только права
cd backend && ../.venv/bin/python -m pytest -q tests/test_permissions_registry.py \
  tests/test_permissions_expected.py tests/test_permissions_wiring.py \
  tests/test_finance_permissions.py; cd ..

# Фронт
cd frontend && npm run typecheck && npm run test -- --run; cd ..

# Пересчитать метрики миграции
grep -rc "current_user.role" backend/app/api/v1/endpoints/ | awk -F: '{s+=$2} END {print "проверок роли:", s}'
grep -rho "require_access(" backend/app/api/v1/endpoints/ | wc -l
```

### После каждого пункта Этапа 2

| Пункт | Что запускать |
|---|---|
| 2.1 эндпоинт | `cd backend && ../.venv/bin/python -m pytest -q` |
| 2.2 страница | `cd frontend && npm run typecheck && npm run build` |
| 2.3 payload | `cd backend && ../.venv/bin/python -m pytest -q tests/test_auth*.py tests/test_permissions*.py` |
| 2.4 `can()` | `cd frontend && npm run typecheck && npm run test -- --run` |
| 2.5 меню/роуты | `cd frontend && npm run typecheck && npm run build` |
| CI e2e | `cd backend && ../.venv/bin/python -m pytest -q` + проверить, что шаг появился в `deploy.yml` |

Правило: **зелёные тесты — условие коммита, а не пожелание.** Каждый пункт — отдельный
коммит.
