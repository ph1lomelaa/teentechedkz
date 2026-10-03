/**
 * Правила отображения Portfolio UP в кабинете ученика — в одном месте, чтобы
 * план, карточка участия и каталог говорили одно и то же.
 */
import type { Activity, BoardColumn, BoardItem, Intake, Participation, StepsSummary } from '@/api/activities'
import { formatDeadline, parseDateOnly } from './roadmapDeadline'

/** Набор, который создаёт импорт Excel. Ученику это название ничего не говорит. */
export const IMPORT_INTAKE_LABEL = 'Из исходной базы'

/** «№8 — Медицина / Биология» → «Медицина / Биология»: номер группы — служебная разметка таблицы. */
export function cleanDirection(direction: string | null | undefined): string {
  return (direction ?? '').replace(/^\s*№\s*\d+\s*[—–-]\s*/, '').trim()
}

export function intakeLabel(intake: Pick<Intake, 'label'> | null | undefined): string | null {
  if (!intake || intake.label === IMPORT_INTAKE_LABEL) return null
  return intake.label
}

export function intakeWhen(intake: Pick<Intake, 'deadline' | 'mode' | 'dates_text'> | null | undefined): string {
  if (!intake) return 'Сроки уточняются'
  if (intake.deadline) return `Дедлайн организатора: ${formatDeadline(intake.deadline)}`
  if (intake.mode === 'rolling') return 'Набор открыт постоянно'
  if (intake.mode === 'self_paced') return 'В своём темпе'
  return intake.dates_text?.trim() || 'Сроки уточняются'
}

export function intakeCost(intake: Pick<Intake, 'cost_state' | 'cost_text'> | null | undefined): string {
  if (intake?.cost_state === 'free') return 'Бесплатно'
  if (intake?.cost_state === 'paid') return intake.cost_text?.trim() || 'Платно'
  return 'Стоимость уточняется'
}

export type PlanGroup = 'decide' | 'active' | 'results' | 'closed'

export function planGroup(item: Pick<Participation, 'decision' | 'status'>): PlanGroup {
  if (item.decision === 'not_interested' || item.status === 'cancelled') return 'closed'
  if (item.status === 'completed') return 'results'
  if (item.decision === 'suggested') return 'decide'
  return 'active'
}

export const PLAN_GROUPS: Array<{ key: PlanGroup; title: string; hint: string }> = [
  { key: 'decide', title: 'Рекомендации ментора', hint: 'Решите, участвуете ли вы' },
  { key: 'active', title: 'В работе', hint: 'Активности, которые вы проходите сейчас' },
  { key: 'results', title: 'Результаты', hint: 'Завершённые активности' },
  { key: 'closed', title: 'Не участвую', hint: '' },
]

export function participationStatus(item: Pick<Participation, 'decision' | 'status'>): string {
  if (item.decision === 'suggested') return 'Рекомендовано'
  if (item.decision === 'not_interested') return 'Не интересно'
  return { not_started: 'Выбрано', in_progress: 'В работе', submitted: 'Заявка подана', completed: 'Завершено', cancelled: 'Отменено' }[item.status]
}

export type NextAction =
  | { kind: 'step'; item: Participation; step: NonNullable<StepsSummary['next']> }
  | { kind: 'waiting'; item: Participation }
  | { kind: 'plan'; item: Participation }
  | { kind: 'empty' }

const STEP_PRIORITY = { returned: 0, overdue: 1, todo: 2 } as const

/**
 * «Следующий шаг» — одно действие на весь план:
 * правки по комментарию → просроченный шаг → ближайший по сроку шаг.
 * Если всё текущее отправлено — «ждём ментора», без лишних кнопок.
 * Рекомендации сюда не попадают: у них свой блок «Предложено ментором».
 */
export function pickNextAction(items: Participation[]): NextAction {
  const active = items.filter((item) => planGroup(item) === 'active')
  const steps = active
    .filter((item) => item.steps?.next && item.steps.next.state !== 'pending')
    .map((item) => ({ item, step: item.steps!.next! }))
    .sort((a, b) =>
      STEP_PRIORITY[a.step.state as keyof typeof STEP_PRIORITY] - STEP_PRIORITY[b.step.state as keyof typeof STEP_PRIORITY]
      || (a.step.due_date ?? '9999').localeCompare(b.step.due_date ?? '9999'))
  if (steps.length) return { kind: 'step', ...steps[0] }
  const waiting = active.find((item) => item.steps?.next?.state === 'pending')
  if (waiting) return { kind: 'waiting', item: waiting }
  const unplanned = active.find((item) => !item.steps?.total)
  if (unplanned) return { kind: 'plan', item: unplanned }
  return { kind: 'empty' }
}

// ---------------------------------------------------------------- направления

/** Номер группы из данных: «№3 — IT» → 3. Цвет выбирается по нему. */
export function directionKey(direction: string | null | undefined): number | null {
  const match = (direction ?? '').match(/^\s*№\s*(\d+)/)
  return match ? Number(match[1]) : null
}

export interface DirectionTone { badge: string; soft: string; line: string }

// Классы целиком, а не `bg-dir-${n}`: Tailwind собирает только то, что видит в коде.
const DIRECTION_TONES: Record<number, DirectionTone> = {
  1: { badge: 'bg-dir-1/15 text-dir-1', soft: 'bg-dir-1/10', line: 'border-dir-1/30' },
  2: { badge: 'bg-dir-2/15 text-dir-2', soft: 'bg-dir-2/10', line: 'border-dir-2/30' },
  3: { badge: 'bg-dir-3/15 text-dir-3', soft: 'bg-dir-3/10', line: 'border-dir-3/30' },
  4: { badge: 'bg-dir-4/15 text-dir-4', soft: 'bg-dir-4/10', line: 'border-dir-4/30' },
  5: { badge: 'bg-dir-5/15 text-dir-5', soft: 'bg-dir-5/10', line: 'border-dir-5/30' },
  6: { badge: 'bg-dir-6/15 text-dir-6', soft: 'bg-dir-6/10', line: 'border-dir-6/30' },
  7: { badge: 'bg-dir-7/15 text-dir-7', soft: 'bg-dir-7/10', line: 'border-dir-7/30' },
  8: { badge: 'bg-dir-8/15 text-dir-8', soft: 'bg-dir-8/10', line: 'border-dir-8/30' },
}
const NEUTRAL_TONE: DirectionTone = { badge: 'bg-ds-line text-ds-muted', soft: 'bg-ds-panel2', line: 'border-ds-line' }

/** Новое направление без номера или за пределами палитры — нейтральный бейдж. */
export function directionTone(direction: string | null | undefined): DirectionTone {
  const key = directionKey(direction)
  return (key && DIRECTION_TONES[key]) || NEUTRAL_TONE
}

/** Направления каталога со счётчиками — для чипов фильтра. Порядок — по номеру группы. */
export function directionCounts(items: Array<Pick<Activity, 'direction'>>): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) if (item.direction) counts.set(item.direction, (counts.get(item.direction) ?? 0) + 1)
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: cleanDirection(value) || value, count }))
    .sort((a, b) => (directionKey(a.value) ?? 999) - (directionKey(b.value) ?? 999) || a.label.localeCompare(b.label, 'ru'))
}

// ---------------------------------------------------------------- сроки

/** Тот же выбор ближайшего набора, что на backend: будущая дата →
 * постоянный набор без дедлайна → неизвестная дата. Прошедший набор не открыт. */
export function nearestActivityIntake(intakes: Intake[], today = new Date().toLocaleDateString('en-CA')): Intake | null {
  const upcoming = intakes.filter(i => i.deadline && i.deadline >= today).sort((a, b) => a.deadline!.localeCompare(b.deadline!))
  return upcoming[0] ?? intakes.find(i => !i.deadline && ['rolling', 'self_paced'].includes(i.mode)) ?? intakes.find(i => !i.deadline) ?? null
}

export type DateState = 'deadline' | 'rolling' | 'year_round' | 'unknown' | 'closed'

/** Честное состояние срока для карточки и строки каталога. Дат не выдумываем. */
export function dateState(activity: Pick<Activity, 'next_intake' | 'intake_count'>): DateState {
  const intake = activity.next_intake
  if (!intake) return activity.intake_count ? 'closed' : 'unknown'
  if (intake.deadline) return 'deadline'
  if (intake.mode === 'rolling') return 'rolling'
  if (intake.mode === 'self_paced') return 'year_round'
  return 'unknown'
}

const DATE_LABEL: Record<Exclude<DateState, 'deadline'>, { short: string; hint: string }> = {
  rolling: { short: 'Rolling', hint: 'Заявки принимают постоянно' },
  year_round: { short: 'Круглый год', hint: 'Можно начать в любой момент' },
  unknown: { short: 'Дата неизвестна', hint: 'Срок уточняется у организатора' },
  closed: { short: 'Набор закрыт', hint: 'Ждём следующий набор' },
}

/** «до 15 окт.» / «Rolling» и пояснение второй строкой. */
export function dateSummary(activity: Pick<Activity, 'next_intake' | 'intake_count'>): { short: string; hint: string; state: DateState } {
  const state = dateState(activity)
  if (state === 'deadline') {
    const intake = activity.next_intake!
    return { state, short: `до ${formatDeadline(intake.deadline!)}`, hint: intakeLabel(intake) ?? 'Дедлайн организатора' }
  }
  const hint = state === 'unknown' ? activity.next_intake?.dates_text?.trim() || DATE_LABEL.unknown.hint : DATE_LABEL[state].hint
  return { state, short: DATE_LABEL[state].short, hint }
}

// ---------------------------------------------------------------- публикация

export const PUBLICATION: Record<Activity['publication'], { label: string; dot: string }> = {
  published: { label: 'Опубликовано', dot: 'bg-ds-good' },
  draft: { label: 'Черновик', dot: 'bg-ds-muted2' },
  archived: { label: 'Архив', dot: 'bg-ds-line' },
}

export type CatalogFilter = 'all' | 'published' | 'draft' | 'review' | 'archived'

export function matchesCatalogFilter(activity: Activity, filter: CatalogFilter): boolean {
  if (filter === 'all') return activity.publication !== 'archived'
  if (filter === 'review') return activity.publication === 'draft' && !!activity.review_issues?.length
  return activity.publication === filter
}

// ---------------------------------------------------------------- доска

export const BOARD_COLUMNS: Array<{ key: Exclude<BoardColumn, 'closed'>; title: string; hint: string }> = [
  { key: 'suggested', title: 'Предложено', hint: 'ждём решения ученика' },
  { key: 'planning', title: 'Выбрано', hint: 'нужно составить план шагов' },
  { key: 'in_work', title: 'В работе', hint: 'ученик выполняет шаги' },
  { key: 'review', title: 'На проверке', hint: 'ждут ответа ментора' },
  { key: 'done', title: 'Завершено', hint: 'результат подтверждён' },
]

export const BOARD_LABEL: Record<BoardColumn, string> = {
  suggested: 'Предложено', planning: 'Выбрано', in_work: 'В работе', review: 'На проверке', done: 'Завершено', closed: 'Закрыто',
}

/** «вчера», «3 дн. назад» — для строки контекста. */
export function relativeDay(value: string | null | undefined, today: Date = new Date()): string {
  if (!value) return ''
  const day = parseDateOnly(value.slice(0, 10))
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((ref.getTime() - day.getTime()) / 86_400_000)
  if (diff <= 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  if (diff < 7) return `${diff} дн. назад`
  return formatDeadline(value.slice(0, 10), today)
}

/** Одна строка контекста карточки доски. */
export function boardContext(item: BoardItem, today: Date = new Date()): string {
  const steps = item.steps
  if (item.column === 'closed') return item.decision === 'not_interested' ? 'Ученику не интересно' : 'Участие отменено'
  if (item.column === 'suggested') return `отправлено ${relativeDay(item.created_at, today)}`
  if (item.column === 'planning') return 'шагов ещё нет'
  if (item.column === 'review') {
    const when = relativeDay(steps?.next?.state === 'pending' ? steps.next.submitted_at : null, today)
    return [steps?.pending && steps.pending > 1 ? `на проверке: ${steps.pending}` : 'работа отправлена', when].filter(Boolean).join(' · ')
  }
  const progress = steps?.total ? `${steps.done} из ${steps.total}` : ''
  if (item.column === 'done') return progress || 'завершено'
  const due = item.due ? `срок ${formatDeadline(item.due, today)}` : ''
  const overdue = steps?.overdue ? `просрочено: ${steps.overdue}` : ''
  return [progress, overdue || due].filter(Boolean).join(' · ')
}

/** Сегменты прогресса: по одному на обязательный шаг. */
export function progressSegments(steps: StepsSummary | undefined): Array<'done' | 'pending' | 'todo'> {
  if (!steps?.total) return []
  if (steps.segment_states?.length === steps.total) return steps.segment_states
  const done = Math.min(steps.done, steps.total)
  const pending = Math.min(steps.pending, steps.total - done)
  return [...Array(done).fill('done'), ...Array(pending).fill('pending'), ...Array(steps.total - done - pending).fill('todo')]
}
