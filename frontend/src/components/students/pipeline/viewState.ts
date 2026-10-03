/**
 * Состояние вида «Пайплайна клиентов», которое живёт в URL: вид, поиск,
 * фильтры, группировка, сортировка и видимые поля. Всё здесь — чистые функции,
 * чтобы ссылку можно было отправить коллеге и получить ровно тот же экран.
 */

export type Operator = 'is' | 'is_not' | 'contains' | 'does_not_contain' | 'greater' | 'less' | 'is_empty' | 'is_not_empty'
export type Condition = { operator: Operator; values: string[] }
export type Filters = Record<string, Condition>
export type PipelineView = 'board' | 'table'

export const OPERATORS: Operator[] = ['is', 'is_not', 'contains', 'does_not_contain', 'greater', 'less', 'is_empty', 'is_not_empty']
export const OPERATOR_LABELS: Record<Operator, string> = {
  is: 'совпадает с', is_not: 'не совпадает с', contains: 'содержит', does_not_contain: 'не содержит',
  greater: 'больше', less: 'меньше', is_empty: 'не заполнено', is_not_empty: 'заполнено',
}

/** Псевдо-значение «ячейка пустая» в фильтре по значениям. */
export const EMPTY = '__EMPTY__'
/** Псевдо-поле «фактические ответственные из CRM» — в Notion такой колонки нет. */
export const ASSIGNED = '__assigned__'
/** Колонка-заголовок Notion (имя клиента): её нельзя скрыть, как title в Notion. */
export const TITLE_FIELD = 'е'

/** Человеческие подписи для полей с техническими названиями в Notion. */
export const FIELD_LABELS: Record<string, string> = {
  [TITLE_FIELD]: 'Имя',
  [ASSIGNED]: 'Ответственные',
  'd в работе': 'Дни в работе',
  'Main country': 'Страна',
}
export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field.trim()

/** Быстрые фильтры — пунктирные чипы в панели. Порядок здесь = порядок на экране. */
export const QUICK_FILTERS: string[] = ['Lead-Mentor', 'Degree', 'Main country']

/** Группировка по умолчанию: доска — колонки по статусу, таблица — по набору. */
export const DEFAULT_GROUP: Record<PipelineView, string> = { board: 'Статус выплат', table: 'Intake' }
/** «Без группировки» в URL: пустое значение нельзя отличить от «по умолчанию». */
export const NO_GROUP = 'none'

export const DEFAULT_SORT = TITLE_FIELD

/** Поля на карточке доски по умолчанию (как в исходной Notion-доске). */
export const DEFAULT_BOARD_FIELDS = ['Degree', 'Lead-Mentor', 'Main country', 'Mentors', 'Other countries', 'Себес', ASSIGNED]

/** Через сколько часов без синхронизации точка статуса становится янтарной. */
export const SYNC_STALE_AFTER_HOURS = 24

/** Задержка поиска перед записью в URL. */
export const SEARCH_DEBOUNCE_MS = 300

export const PARAM = {
  view: 'view', search: 'q', filters: 'f', group: 'group', sort: 'sort', dir: 'dir', fields: 'fields',
} as const

export function parseFilters(raw: string | null): Filters {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, item]) => {
      const condition = item as Condition
      return OPERATORS.includes(condition?.operator) && Array.isArray(condition.values) && condition.values.every((v) => typeof v === 'string')
    })) as Filters
  } catch {
    return {}
  }
}

/** null — «фильтров нет», параметр из URL убирается совсем. */
export function serializeFilters(filters: Filters): string | null {
  return Object.keys(filters).length ? JSON.stringify(filters) : null
}

export function parseView(params: URLSearchParams): PipelineView {
  const view = params.get(PARAM.view)
  if (view === 'board' || view === 'table') return view
  // Старые ссылки: ?nv=board.
  return params.get('nv') === 'board' ? 'board' : 'table'
}

/** Список полей в URL: через запятую, порядок значим. */
export function parseFieldList(raw: string | null): string[] | null {
  if (raw == null) return null
  return raw.split(',').map((item) => decodeURIComponent(item)).filter(Boolean)
}
export function serializeFieldList(fields: string[]): string {
  return fields.map((field) => encodeURIComponent(field)).join(',')
}

/**
 * Подпись активного фильтра на чипе: «Intake: 2026», «Lead-Mentor: Bibinur, Daria»,
 * при трёх и больше значений — «Lead-Mentor: 3».
 */
export function filterChipLabel(field: string, condition: Condition): string {
  const name = fieldLabel(field)
  const values = condition.values.map((value) => value === EMPTY ? 'не заполнено' : value)
  switch (condition.operator) {
    case 'is_empty': return `${name}: не заполнено`
    case 'is_not_empty': return `${name}: заполнено`
    case 'greater': return `${name} > ${values[0] ?? '…'}`
    case 'less': return `${name} < ${values[0] ?? '…'}`
    case 'contains': return `${name} содержит ${values[0] ?? '…'}`
    case 'does_not_contain': return `${name} не содержит ${values[0] ?? '…'}`
    default: {
      const list = values.length === 0 ? 'выбрать…' : values.length > 2 ? String(values.length) : values.join(', ')
      return `${name}${condition.operator === 'is_not' ? ' ≠' : ':'} ${list}`
    }
  }
}

/** «сегодня в 18:30», «вчера в 09:10», иначе «12.09.2026 в 14:00». */
export function formatSyncTime(at: Date, now: Date = new Date()): string {
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days === 0) return `сегодня в ${time}`
  if (days === 1) return `вчера в ${time}`
  return `${at.toLocaleDateString('ru-RU')} в ${time}`
}

export type SyncHealth = 'ok' | 'stale' | 'error' | 'unknown'

export function syncHealth(lastRun: { at: string | null; ok: boolean | null } | undefined, now: Date = new Date()): SyncHealth {
  if (!lastRun?.at) return 'unknown'
  if (lastRun.ok === false) return 'error'
  const ageHours = (now.getTime() - new Date(lastRun.at).getTime()) / 3_600_000
  return ageHours > SYNC_STALE_AFTER_HOURS ? 'stale' : 'ok'
}

/**
 * Итоговый порядок видимых полей: из URL, иначе из памяти пользователя, иначе
 * по умолчанию. Поля, которых больше нет в данных, отбрасываются; заголовок
 * таблицы всегда первый и всегда виден.
 */
export function resolveVisibleFields(
  fromUrl: string[] | null,
  remembered: string[] | null,
  fallback: string[],
  available: string[],
): string[] {
  const known = new Set(available)
  const list = (fromUrl ?? remembered ?? fallback).filter((field) => known.has(field) && field !== TITLE_FIELD)
  return [...new Set(list)]
}
