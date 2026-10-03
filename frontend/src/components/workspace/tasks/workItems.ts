/**
 * Единая модель страницы «Задачи» кабинета сотрудника.
 *
 * Страница показывает два разных объекта бэкенда одним списком:
 *  - шаг roadmap студента (WorkspaceRoadmapTask: planned / in_progress / done,
 *    заявка студента на проверку живёт отдельно, в review_status);
 *  - поручение сотруднику (StudentTask: десять статусов, SLA, приёмка).
 *
 * Здесь они приводятся к одному виду. Решения «просрочено» и «в какую корзину
 * срока попадает» принимаются в этом файле и больше нигде — иначе чипы-счётчики,
 * сортировка и подсветка строк разойдутся.
 *
 * Модуль чистый (без React и запросов), поэтому покрыт юнит-тестами.
 */
import type { WorkspaceRoadmapTask } from '@/api/workspace'
import type { StudentTask } from '@/types'
import { isTaskLive } from '@/lib/taskUrgency'

export type WorkKind = 'roadmap' | 'delegated'

/** Единый словарь статусов для человека; исходный статус остаётся в `raw`. */
export type WorkStatus = 'todo' | 'in_progress' | 'review' | 'revision' | 'done' | 'cancelled'

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

export type Weight = 'high' | 'normal' | 'low'

export interface WorkItem {
  key: string
  kind: WorkKind
  id: string
  title: string
  studentId: string | null
  studentName: string | null
  /** Этап roadmap или «Поручение · исполнитель». */
  context: string
  status: WorkStatus
  /** Исходный статус бэкенда — нужен для выбора действия в строке. */
  raw: string
  /** Задача ждёт подписи регламента: часы SLA на неё не идут. */
  blocked: boolean
  /** Календарная дата YYYY-MM-DD в локальной зоне или null. */
  due: string | null
  /** Целых дней просрочки на сегодня; 0 — не просрочено. */
  overdueDays: number
  weight: Weight
  /** Короткая подпись важности, если она есть. */
  marker: string | null
  roadmap?: WorkspaceRoadmapTask
  delegated?: StudentTask
}

export const STATUS_LABEL: Record<WorkStatus, string> = {
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  revision: 'На доработке',
  done: 'Готово',
  cancelled: 'Отменена',
}

export const BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: 'Просрочено',
  today: 'Сегодня',
  week: 'Эта неделя',
  later: 'Позже',
  none: 'Без срока',
}

export function isClosed(status: WorkStatus): boolean {
  return status === 'done' || status === 'cancelled'
}

// ---------- даты ----------

const MS_PER_DAY = 24 * 60 * 60 * 1000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Разница в целых календарных днях: положительная — срок в будущем. */
export function daysUntil(due: string, today: Date = new Date()): number {
  return Math.round((parseDateKey(due).getTime() - startOfDay(today).getTime()) / MS_PER_DAY)
}

export function bucketOf(item: Pick<WorkItem, 'due' | 'overdueDays' | 'status'>, today: Date = new Date()): DueBucket {
  // Закрытая задача срока не имеет смысла: иначе её прошлая дата попала бы в «Сегодня».
  if (isClosed(item.status)) return 'none'
  if (item.overdueDays > 0) return 'overdue'
  if (!item.due) return 'none'
  const days = daysUntil(item.due, today)
  if (days <= 0) return 'today'
  if (days <= 7) return 'week'
  return 'later'
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

export function formatDue(due: string): string {
  return DATE_FMT.format(parseDateKey(due)).replace('.', '')
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «просрочено на 3 дня», «завтра», «через 5 дней» — вторая строка ячейки срока. */
export function relativeDue(item: Pick<WorkItem, 'due' | 'overdueDays'>, today: Date = new Date()): string {
  if (!item.due) return ''
  if (item.overdueDays > 0) {
    const n = item.overdueDays
    return `просрочено на ${n} ${plural(n, 'день', 'дня', 'дней')}`
  }
  const days = daysUntil(item.due, today)
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  if (days > 1) return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`
  return ''
}

// ---------- нормализация ----------

function overdueDaysFor(due: string | null, live: boolean, forcedOverdue: boolean, today: Date): number {
  if (!live) return 0
  const computed = due ? Math.max(0, -daysUntil(due, today)) : 0
  if (computed > 0) return computed
  // Бэкенд уже пометил задачу просроченной (SLA в часах внутри суток): срок в
  // днях ещё не прошёл, но показывать её как «в срок» было бы неправдой.
  return forcedOverdue ? 1 : 0
}

export function fromRoadmap(task: WorkspaceRoadmapTask, today: Date = new Date()): WorkItem {
  const status: WorkStatus =
    task.status === 'done'
      ? 'done'
      : task.review_status === 'pending'
        ? 'review'
        : task.review_status === 'returned'
          ? 'revision'
          : task.status === 'in_progress'
            ? 'in_progress'
            : 'todo'
  const live = !isClosed(status)
  const due = task.due_date
  return {
    key: `roadmap:${task.id}`,
    kind: 'roadmap',
    id: task.id,
    title: task.title,
    studentId: task.student_id,
    studentName: task.student_name,
    context: task.stage_name,
    status,
    raw: task.status,
    blocked: false,
    due,
    overdueDays: overdueDaysFor(due, live, Boolean(task.urgency && task.urgency !== 'none'), today),
    weight: task.priority === 'required' ? 'high' : task.priority === 'optional' ? 'low' : 'normal',
    marker: task.priority === 'required' ? 'Обязательно' : null,
    roadmap: task,
  }
}

const DELEGATED_STATUS: Record<StudentTask['status'], WorkStatus> = {
  open: 'todo',
  awaiting_signature: 'todo',
  blocked_by_agreement: 'todo',
  in_progress: 'in_progress',
  submitted: 'review',
  needs_revision: 'revision',
  overdue: 'in_progress',
  accepted: 'done',
  done: 'done',
  cancelled: 'cancelled',
}

const DELEGATED_MARKER: Partial<Record<NonNullable<StudentTask['priority']>, string>> = {
  urgent: 'Срочно',
  high: 'Высокий приоритет',
}

/** Срок поручения: календарная дата, а при её отсутствии — день SLA-дедлайна. */
function delegatedDue(task: StudentTask): string | null {
  if (task.due_date) return task.due_date.slice(0, 10)
  if (task.sla_due_at) {
    const parsed = new Date(task.sla_due_at)
    return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed)
  }
  return null
}

export function fromDelegated(task: StudentTask, today: Date = new Date()): WorkItem {
  const status = DELEGATED_STATUS[task.status] ?? 'todo'
  const due = delegatedDue(task)
  const live = isTaskLive(task.status)
  const owner = task.assignee_name ? `Поручение · ${task.assignee_name}` : 'Поручение · без исполнителя'
  const priority = task.priority ?? 'normal'
  return {
    key: `delegated:${task.id}`,
    kind: 'delegated',
    id: task.id,
    title: task.task_text,
    studentId: task.student_id,
    studentName: task.student_name ?? null,
    context: owner,
    status,
    raw: task.status,
    blocked: task.status === 'awaiting_signature' || task.status === 'blocked_by_agreement',
    due,
    overdueDays: overdueDaysFor(due, live, Boolean(task.sla_overdue) || task.status === 'overdue', today),
    weight: priority === 'urgent' || priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'normal',
    marker: DELEGATED_MARKER[priority] ?? null,
    delegated: task,
  }
}

// ---------- фильтры, сортировка, счётчики ----------

export type SortKey = 'due' | 'student' | 'title'
export type SortDir = 'asc' | 'desc'

const WEIGHT_ORDER: Record<Weight, number> = { high: 0, normal: 1, low: 2 }

export function compareItems(a: WorkItem, b: WorkItem, key: SortKey): number {
  if (key === 'student') {
    const byStudent = (a.studentName ?? '').localeCompare(b.studentName ?? '', 'ru')
    return byStudent || compareItems(a, b, 'due')
  }
  if (key === 'title') return a.title.localeCompare(b.title, 'ru')
  // Срок: дата по возрастанию, без срока — в конец; при равенстве важное выше.
  if (a.due !== b.due) {
    if (!a.due) return 1
    if (!b.due) return -1
    return a.due < b.due ? -1 : 1
  }
  const byWeight = WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight]
  return byWeight || (a.studentName ?? '').localeCompare(b.studentName ?? '', 'ru')
}

export function sortItems(items: WorkItem[], key: SortKey, dir: SortDir): WorkItem[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    // «Без срока» остаётся в конце при любом направлении сортировки по сроку.
    if (key === 'due' && (!a.due || !b.due) && a.due !== b.due) return compareItems(a, b, key)
    return sign * compareItems(a, b, key)
  })
}

export interface ItemFilter {
  query: string
  kind: WorkKind | 'all'
  bucket: DueBucket | 'all'
  studentId?: string
}

export function matchesQuery(item: WorkItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    item.title.toLowerCase().includes(q) ||
    (item.studentName ?? '').toLowerCase().includes(q) ||
    item.context.toLowerCase().includes(q)
  )
}

/** Всё, кроме корзины срока: по этому набору считаются чипы-счётчики. */
export function applyBaseFilter(items: WorkItem[], filter: Omit<ItemFilter, 'bucket'>): WorkItem[] {
  return items.filter(
    (item) =>
      (filter.kind === 'all' || item.kind === filter.kind) &&
      (!filter.studentId || item.studentId === filter.studentId) &&
      matchesQuery(item, filter.query),
  )
}

export function countBuckets(items: WorkItem[], today: Date = new Date()): Record<DueBucket | 'all', number> {
  const counts: Record<DueBucket | 'all', number> = { all: items.length, overdue: 0, today: 0, week: 0, later: 0, none: 0 }
  for (const item of items) counts[bucketOf(item, today)] += 1
  return counts
}

export function filterByBucket(items: WorkItem[], bucket: DueBucket | 'all', today: Date = new Date()): WorkItem[] {
  return bucket === 'all' ? items : items.filter((item) => bucketOf(item, today) === bucket)
}

// ---------- сводка по студентам ----------

export interface StudentRollup {
  studentId: string
  studentName: string
  open: number
  overdue: number
  review: number
  /** Ближайший срок среди открытых задач. */
  nextDue: string | null
}

export function rollupByStudent(items: WorkItem[]): StudentRollup[] {
  const map = new Map<string, StudentRollup>()
  for (const item of items) {
    if (!item.studentId || isClosed(item.status)) continue
    const row =
      map.get(item.studentId) ??
      { studentId: item.studentId, studentName: item.studentName ?? 'Студент', open: 0, overdue: 0, review: 0, nextDue: null }
    row.open += 1
    if (item.overdueDays > 0) row.overdue += 1
    if (item.status === 'review') row.review += 1
    if (item.due && (!row.nextDue || item.due < row.nextDue)) row.nextDue = item.due
    map.set(item.studentId, row)
  }
  return [...map.values()]
}
