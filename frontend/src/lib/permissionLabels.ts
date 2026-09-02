/**
 * Человеческие названия разделов для страницы прав.
 *
 * Зачем понадобилось
 * ------------------
 * Реестр прав использует технические ключи (`confidential_notes`,
 * `tasks_assign_mzk`). Раньше страница показывала только их — из соображения,
 * что перевод стал бы вторым названием одного и того же права и они разъедутся.
 * На практике администратор, который эту страницу и открывает, читать её не мог.
 *
 * Компромисс: показываем и то, и другое — крупно человеческое название, рядом
 * мелко сам ключ. Ключ остаётся видимым и остаётся единственной правдой при
 * разговоре с разработчиком; название лишь помогает понять, о чём строка.
 * Поэтому здесь именно `label`, а не «перевод»: если ключа тут нет, страница
 * покажет его как есть и ничего не сломается.
 */

export interface ResourceGroup {
  title: string
  hint: string
  resources: string[]
}

/**
 * Порядок групп — от того, чем пользуются каждый день, к системному.
 * Раздел, которого нет ни в одной группе, попадёт в «Прочее» — так новый
 * ключ в реестре не исчезает со страницы молча.
 */
export const RESOURCE_GROUPS: ResourceGroup[] = [
  {
    title: 'Ученик и его данные',
    hint: 'Карточка, контакты, доступ в кабинет',
    resources: [
      'students', 'student_access', 'responsibilities', 'mentor_assignments',
      'guardians', 'emergency_contacts', 'confidential_notes', 'documents',
      'credentials', 'student_universities', 'applications', 'portfolio',
      'services', 'status_history',
    ],
  },
  {
    title: 'Работа с учеником',
    hint: 'Задачи, встречи, переписка, дорожная карта',
    resources: [
      'tasks', 'tasks_general', 'tasks_bulk', 'tasks_review',
      'tasks_assign_mentor', 'tasks_assign_mzk', 'tasks_accept_result',
      'tasks_deadlines', 'roadmaps', 'roadmap_templates', 'meetings',
      'notes', 'note_sessions', 'communication', 'chat', 'telegram_chats',
      'questionnaires', 'checkins',
    ],
  },
  {
    title: 'Деньги и договоры',
    hint: 'Оплаты, договоры, вознаграждение менторов',
    resources: [
      'finances', 'contracts', 'contract_addenda', 'refund_cases',
      'refund_approval', 'mentor_rewards', 'reward_rules',
    ],
  },
  {
    title: 'Качество и обращения',
    hint: 'Жалобы, оценка работы, инциденты',
    resources: ['complaints', 'mzk_quality', 'security_incidents'],
  },
  {
    title: 'Справочники',
    hint: 'Общие данные, одинаковые для всех учеников',
    resources: ['universities', 'countries', 'scholarships', 'knowledge'],
  },
  {
    title: 'Система и доступы',
    hint: 'Кто вообще попадает в систему и что видно в журнале',
    resources: [
      'users', 'access_requests', 'permissions', 'audit', 'agreements',
      'integrations', 'sync', 'notion', 'export', 'portal', 'workspace',
    ],
  },
]

export const RESOURCE_LABELS: Record<string, string> = {
  // Ученик и его данные
  students: 'Карточки учеников',
  student_access: 'Доступ ученика в кабинет',
  responsibilities: 'Кто за что отвечает',
  mentor_assignments: 'Назначение менторов',
  guardians: 'Родители и опекуны',
  emergency_contacts: 'Экстренные контакты',
  confidential_notes: 'Конфиденциальные заметки',
  documents: 'Документы ученика',
  credentials: 'Логины и пароли ученика',
  student_universities: 'Университеты ученика',
  applications: 'Заявки в университеты',
  portfolio: 'Портфолио',
  services: 'Услуги по договору',
  status_history: 'История статусов',

  // Работа с учеником
  tasks: 'Задачи ученику',
  tasks_general: 'Общие задачи (не по ученику)',
  tasks_bulk: 'Массовые действия с задачами',
  tasks_review: 'Проверка выполненных задач',
  tasks_assign_mentor: 'Назначить задачу ментору',
  tasks_assign_mzk: 'Назначить задачу МЗК',
  tasks_accept_result: 'Принять результат задачи',
  tasks_deadlines: 'Сроки задач',
  roadmaps: 'Дорожная карта ученика',
  roadmap_templates: 'Шаблоны дорожных карт',
  meetings: 'Встречи и созвоны',
  notes: 'Конспекты',
  note_sessions: 'Записи и расшифровки встреч',
  communication: 'Журнал переписки и звонков',
  chat: 'Чат с учеником в портале',
  telegram_chats: 'Telegram-группы учеников',
  questionnaires: 'Анкеты и опросники',
  checkins: 'Чекины команды',

  // Деньги и договоры
  finances: 'Финансы и оплаты',
  contracts: 'Договоры',
  contract_addenda: 'Дополнительные соглашения',
  refund_cases: 'Возвратные кейсы',
  refund_approval: 'Утверждение возврата денег',
  mentor_rewards: 'Вознаграждение менторов',
  reward_rules: 'Правила начисления вознаграждения',

  // Качество и обращения
  complaints: 'Обращения и жалобы',
  mzk_quality: 'Оценка качества работы МЗК',
  security_incidents: 'Инциденты безопасности',

  // Справочники
  universities: 'Справочник университетов',
  countries: 'Справочник стран',
  scholarships: 'Стипендии и гранты',
  knowledge: 'База знаний',

  // Система и доступы
  users: 'Пользователи системы',
  access_requests: 'Заявки на доступ',
  permissions: 'Права доступа',
  audit: 'Журнал действий',
  agreements: 'Регламенты и подписи',
  integrations: 'Внешние интеграции',
  sync: 'Импорт анкет из таблиц',
  notion: 'Синхронизация с Notion',
  export: 'Выгрузка в Excel',
  portal: 'Кабинет ученика',
  workspace: 'Кабинет сотрудника',
}

/** Название для показа. Незнакомый ключ отдаём как есть — не прячем. */
export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource
}

const GROUP_BY_RESOURCE = new Map<string, string>(
  RESOURCE_GROUPS.flatMap((g) => g.resources.map((r) => [r, g.title] as const)),
)

export const OTHER_GROUP = 'Прочее'

export function groupTitleFor(resource: string): string {
  return GROUP_BY_RESOURCE.get(resource) ?? OTHER_GROUP
}
