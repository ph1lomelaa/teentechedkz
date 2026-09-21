-- Удаление тестовых аккаунтов.
--
-- Перед запуском обязательно снять дамп:  bash scripts/backup.sh
--
-- Запуск:
--   docker exec -i tte_postgres_prod psql -U tte -d tte_db -v ON_ERROR_STOP=1 < delete_test_users.sql
--
-- Скрипт целиком в одной транзакции: если хоть что-то пойдёт не так,
-- откатится всё, и база останется в прежнем виде.

\set ON_ERROR_STOP on

BEGIN;

-- Список задан явными адресами, а не условием «неактивные»: под «неактивные»
-- попадают и настоящие люди, ждущие одобрения, и такой скрипт снёс бы их молча.
CREATE TEMP TABLE _victims ON COMMIT DROP AS
SELECT id, name, email, role::text AS role
FROM users
WHERE email IN (
    '230103269@sdu.edu.kz',
    'anvarakulxd@gmail.com',
    'muslima5671@gmail.com',
    'muslima5677@gmail.com',
    'testmzk@gmail.com'
  )
  -- Страховка: администратора этот скрипт не удалит ни при какой опечатке
  -- в списке выше. Остаться без единственного админа — невосстановимо через
  -- интерфейс.
  AND role <> 'admin';

\echo '=== Будут удалены ==='
SELECT name, email, role FROM _victims;

\echo '=== Что на них ссылается (пусто — значит следов работы нет) ==='
DO $$
DECLARE
    fk   record;
    cnt  bigint;
    ids  uuid[];
    rule text;
BEGIN
    SELECT array_agg(id) INTO ids FROM _victims;
    IF ids IS NULL THEN
        RAISE EXCEPTION 'Ни один из указанных адресов не найден — проверьте список';
    END IF;

    FOR fk IN
        SELECT c.conrelid::regclass::text AS tbl,
               a.attname                  AS col,
               c.confdeltype              AS del
        FROM pg_constraint c
        JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
        ORDER BY 1, 2
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', fk.tbl, fk.col)
            INTO cnt USING ids;
        IF cnt > 0 THEN
            rule := CASE fk.del
                        WHEN 'c' THEN 'удалится вместе с пользователем'
                        WHEN 'n' THEN 'останется, ссылка обнулится'
                        WHEN 'd' THEN 'останется, подставится значение по умолчанию'
                        ELSE          'ЗАБЛОКИРУЕТ удаление'
                    END;
            RAISE NOTICE '% . % — % строк(и): %', fk.tbl, fk.col, cnt, rule;
        END IF;
    END LOOP;
END $$;

\echo '=== Назначения этих аккаунтов: у кого из студентов они числятся ==='
SELECT s.full_name AS student, ma.role::text AS role, v.name AS mentor
FROM mentor_assignments ma
JOIN _victims v ON v.id = ma.mentor_id
JOIN students  s ON s.id = ma.student_id;

-- Назначение не удаляем, а возвращаем в «ответственный требуется».
--
-- Удали мы строку — студент молча потерял бы слот роли, и увидеть это было бы
-- негде: в команде просто стало бы на одного меньше. Плейсхолдер же остаётся
-- видимым «нужен ментор по этой роли», а назначенный позже человек его просто
-- заполнит (mentor_assignments.py, ветка required).
UPDATE mentor_assignments
SET mentor_id = NULL,
    assignment_status = 'required'
WHERE mentor_id IN (SELECT id FROM _victims);

DELETE FROM users WHERE id IN (SELECT id FROM _victims);

\echo '=== Осталось пользователей ==='
SELECT role::text AS role, count(*) FROM users GROUP BY 1 ORDER BY 1;

COMMIT;
