import { ResponsibleUser, StudentListItem } from '@/types'

/**
 * Фильтры списков студентов, общие для «Общей базы» и «Моих студентов».
 *
 * Жили в StudentsListPage, и вторая страница импортировала бы их из первой —
 * то есть тянула бы за собой всю страницу ради двух функций. Здесь же они
 * остаются одной реализацией: разъехавшись, «Контроль работы» отвечал бы на
 * двух экранах по-разному, а это фильтр, по которому разбирают бэклог.
 */

/** Сигналы «Контроль работы»: что с учеником не так прямо сейчас. */
export type OperationalFilter =
  | 'all'
  | 'no_roadmap'
  | 'no_meeting'
  | 'telegram_unlinked'
  | 'open_tasks'
  | 'docs_review'
  | 'overdue_tasks'
  | 'open_complaints'
  | 'renewal'
  | 'name_only_mentor'

export const OPERATIONAL_FILTER_LABELS: Record<OperationalFilter, string> = {
  all: 'Все',
  no_roadmap: 'Нет roadmap',
  no_meeting: 'Нет ближайшей встречи',
  telegram_unlinked: 'Telegram не привязан',
  open_tasks: 'Есть незакрытые задачи',
  overdue_tasks: 'Просроченные задачи',
  open_complaints: 'Открытые обращения',
  docs_review: 'Документы на проверке',
  renewal: 'Контракт 500 (перепродление)',
  name_only_mentor: 'Ментор только по имени',
}

/**
 * Действующие ответственные студента, МЗК первым.
 *
 * МЗК ведёт студента целиком и отвечает за него перед клиентом — в колонке из
 * пяти пилюль он должен читаться первым, а не тем, кого раньше назначили.
 * Порядок остальных сохраняем как пришёл: он уже отсортирован по дате.
 */
export function activeResponsibles(s: StudentListItem): ResponsibleUser[] {
  const active = (s.responsibles ?? []).filter((r) => r.is_active)
  return [...active].sort((a, b) => Number(b.role === 'mzk') - Number(a.role === 'mzk'))
}

/**
 * Один сигнал операционного фильтра — чистая функция ради юнит-теста:
 * подмешать сюда что-то новое и забыть проверить границу («0» не равно «есть»,
 * null не равно false) — ровно тот класс ошибок, который незаметен в JSX и
 * заметен в тесте.
 */
export function matchesOperationalFilter(s: StudentListItem, filter: OperationalFilter): boolean {
  switch (filter) {
    case 'no_roadmap':
      return !s.roadmap?.id
    case 'no_meeting':
      return !s.next_meeting
    case 'telegram_unlinked':
      return !s.telegram?.linked
    case 'open_tasks':
      return (s.open_tasks_count ?? 0) > 0
    case 'overdue_tasks':
      return !!s.has_overdue_tasks
    case 'open_complaints':
      return !!s.has_open_complaints
    case 'docs_review':
      return (s.documents_unverified ?? 0) > 0
    // «Контракт 500»: risk_category уже считается на бэке (students.py,
    // RENEWAL_THRESHOLD_DAYS = 500) и виден на «Рисках» — здесь его не
    // было ни разу, хотя это тот же самый список студентов, отобранный
    // тем же сигналом. Значение то же ('renewal'), что и у AtRiskStudentsPage,
    // а не отдельная строка 'contract_500' — иначе два места одной и той же
    // проверки снова разошлись бы по имени.
    case 'renewal':
      return s.risk_category === 'renewal'
    // Ментор есть текстом (импорт из Notion), но настоящего назначения нет —
    // такой ментор студента у себя не видит. В списке это неотличимо от
    // нормально назначенного, поэтому нужен способ собрать весь бэклог разом.
    case 'name_only_mentor':
      return activeResponsibles(s).length === 0 && (s.mentors?.length ?? 0) > 0
    default:
      return true
  }
}
