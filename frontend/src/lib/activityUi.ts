/**
 * Правила отображения Portfolio UP в кабинете ученика — в одном месте, чтобы
 * план, карточка участия и каталог говорили одно и то же.
 */
import type { Activity, ActivityInput, BoardColumn, BoardItem, ExperienceKey, Intake, IntakeInput, Participation, PortfolioAction, StepsSummary, TemplateStep } from '@/api/activities'
import type { StepInput } from '@/api/learnerTasks'
import { formatDeadline, parseDateOnly } from './roadmapDeadline'
import { EXPERIENCE_LABEL, INTAKE_MODE_LABEL, PARTICIPATION_STAGE, formatDay, formatDue, formatPast, participationStage } from './portfolio/dictionary'

export { EXPERIENCE_TYPES, EXPERIENCE_LABEL, isExperienceKey } from './portfolio/dictionary'

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
  if (intake.mode === 'rolling') return INTAKE_MODE_LABEL.rolling
  if (intake.mode === 'self_paced') return INTAKE_MODE_LABEL.self_paced
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
  { key: 'decide', title: 'Рекомендации', hint: 'Решите, участвуете ли вы' },
  { key: 'active', title: 'Участия', hint: 'То, что вы проходите сейчас' },
  { key: 'results', title: 'Достижения', hint: 'Итог подтверждён ментором' },
  { key: 'closed', title: 'Не участвую', hint: '' },
]

export function participationStatus(item: Pick<Participation, 'decision' | 'status' | 'result_review_status'>): string {
  return PARTICIPATION_STAGE[participationStage(item)].label
}

export type NextAction =
  | { kind: 'step'; item: Participation; step: NonNullable<StepsSummary['next']> }
  | { kind: 'waiting'; item: Participation }
  | { kind: 'result'; item: Participation }
  | { kind: 'result_waiting'; item: Participation }
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
  const result = active.find(item => item.result_review_status !== undefined && item.result_review_status !== 'pending' && (item.steps?.total ?? 0) > 0 && item.steps?.done === item.steps?.total)
  if (result) return { kind: 'result', item: result }
  const pendingResult = active.find(item => item.result_review_status === 'pending')
  if (pendingResult) return { kind: 'result_waiting', item: pendingResult }
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
  rolling: { short: INTAKE_MODE_LABEL.rolling, hint: 'Заявки принимают в любой момент' },
  year_round: { short: INTAKE_MODE_LABEL.self_paced, hint: 'Можно начать в любой момент' },
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
  // «Нужно дополнить»: не хватает полей, в том числе у старых опубликованных записей.
  if (filter === 'review') return activity.publication !== 'archived' && !!activity.review_issues?.length
  return activity.publication === filter
}

// ---------------------------------------------------------------- доска

export const BOARD_COLUMNS: Array<{ key: Exclude<BoardColumn, 'closed'>; title: string; hint: string }> = [
  { key: 'suggested', title: 'Рекомендация', hint: 'ученик ещё не решил' },
  { key: 'planning', title: 'Нужен план', hint: 'шагов ещё нет' },
  { key: 'in_work', title: 'В работе', hint: 'ученик выполняет шаги' },
  { key: 'review', title: 'На проверке', hint: 'нужно от ментора' },
  { key: 'done', title: 'Достижение', hint: 'итог подтверждён' },
]

export const BOARD_LABEL: Record<BoardColumn, string> = {
  suggested: 'Рекомендация', planning: 'Нужен план', in_work: 'В работе', review: 'На проверке', done: 'Достижение', closed: 'Не участвует',
}

/** «вчера», «3 дня назад» — для строки контекста. */
export function relativeDay(value: string | null | undefined, today: Date = new Date()): string {
  return value ? formatPast(value, today) : ''
}

/** Одна строка контекста карточки доски. */
export function boardContext(item: BoardItem, today: Date = new Date()): string {
  const steps = item.steps
  if (item.column === 'closed') return item.decision === 'not_interested' ? 'Ученику не интересно' : 'Участие отменено'
  if (item.column === 'suggested') return `рекомендовано ${relativeDay(item.created_at, today)}`
  if (item.column === 'planning') return 'шагов ещё нет'
  if (item.column === 'review') {
    if (item.result_review_status === 'pending') return 'Итог на проверке'
    const when = relativeDay(steps?.next?.state === 'pending' ? steps.next.submitted_at : null, today)
    return [steps?.pending && steps.pending > 1 ? `на проверке: ${steps.pending}` : 'шаг на проверке', when].filter(Boolean).join(' · ')
  }
  const progress = steps?.total ? `${steps.done} из ${steps.total}` : ''
  if (item.column === 'done') return 'итог подтверждён'
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

// ---------------------------------------------------------------- портфолио



export interface ActionCopy { title: string; detail: string; cta: string | null; tone: 'urgent' | 'normal' | 'calm' }

/**
 * Текст пункта «Сейчас». viewer — кто смотрит: ученику и ментору нужно разное,
 * а сам пункт один и тот же (сервер считает его одной функцией).
 */
export function actionCopy(action: PortfolioAction, viewer: 'student' | 'staff', today: Date = new Date()): ActionCopy {
  const step = action.step_title ? `«${action.step_title}»` : ''
  if (viewer === 'staff') {
    if (action.kind === 'result_waiting') return { title: 'Подтвердить итог участия', detail: action.activity_title, cta: 'Проверить итог', tone: 'urgent' }
    if (action.kind === 'step_waiting') return { title: step ? `Проверить шаг ${step}` : 'Проверить отправленные шаги', detail: action.activity_title, cta: 'Проверить', tone: 'urgent' }
    if (action.kind === 'plan_waiting') return { title: 'Составить план шагов', detail: action.activity_title, cta: 'Составить план', tone: 'normal' }
  }
  const plain = action.step_title ? `шаг «${action.step_title}»` : 'шаг'
  const dueText = action.due_date ? `срок ${formatDue(action.due_date, today)}` : ''
  switch (action.kind) {
    case 'fix_step': return { title: `Исправьте ${plain}`, detail: [action.activity_title, dueText].filter(Boolean).join(' · '), cta: 'Исправить', tone: 'urgent' }
    case 'fix_result': return { title: 'Исправьте итог', detail: action.activity_title, cta: 'Исправить итог', tone: 'urgent' }
    case 'do_step': return action.overdue
      ? { title: `Сделайте ${plain}`, detail: [action.activity_title, action.due_date ? `срок прошёл ${formatDay(action.due_date, today)}` : ''].filter(Boolean).join(' · '), cta: 'Открыть шаг', tone: 'urgent' }
      : { title: `Сделайте ${plain}`, detail: [action.activity_title, dueText].filter(Boolean).join(' · '), cta: 'Открыть шаг', tone: 'normal' }
    case 'submit_result': return { title: 'Отправьте итог участия', detail: `${action.activity_title} · шаги готовы, осталось описать итог и приложить файл`, cta: 'Отправить итог', tone: 'normal' }
    case 'decide': return { title: `Рекомендация: ${action.activity_title}`, detail: [
      action.experience_type ? EXPERIENCE_LABEL[action.experience_type] : '',
      action.decide_by ? `решите до ${formatDay(action.decide_by, today)}` : '',
      action.submit_deadline ? `подача у организатора до ${formatDay(action.submit_deadline, today)}` : '',
    ].filter(Boolean).join(' · ') || 'Решите, будете ли участвовать', cta: null, tone: 'normal' }
    case 'step_waiting': return { title: 'Шаг на проверке', detail: [step, action.activity_title].filter(Boolean).join(' · '), cta: null, tone: 'calm' }
    case 'result_waiting': return { title: 'Итог участия на проверке', detail: `${action.activity_title} · ментор подтвердит или вернёт с комментарием`, cta: null, tone: 'calm' }
    case 'plan_waiting': return { title: 'Ментор готовит шаги', detail: action.activity_title, cta: null, tone: 'calm' }
  }
}

/** Ссылка на участие; шаг открывается по якорю. */
export function participationPath(base: '/portal' | '/workspace', action: Pick<PortfolioAction, 'participation_id' | 'step_id' | 'kind'>): string {
  const anchor = action.step_id && action.kind !== 'step_waiting' ? `#step-${action.step_id}` : ['submit_result', 'fix_result', 'result_waiting'].includes(action.kind) ? '#result' : ''
  return `${base}/activities/participations/${action.participation_id}${anchor}`
}

/** Ближайший срок участия — то же правило, что nearest_due на backend: личный, организатора, следующего шага. */
export function nearestDue(item: Pick<Participation, 'personal_deadline' | 'intake' | 'steps'>): string | null {
  const dates = [item.personal_deadline, item.intake?.deadline, item.steps?.next?.due_date].filter((d): d is string => Boolean(d))
  return dates.sort()[0] ?? null
}

// ---------------------------------------------------------------- конструктор активности

/** Чего не хватает до публикации — то же правило, что review_issues на backend. */
export function publishIssues(form: Pick<ActivityInput, 'source_url' | 'description'>, intakes: Array<Pick<IntakeInput, 'mode' | 'deadline' | 'cost_state'>>): string[] {
  const issues: string[] = []
  if (!form.source_url?.trim()) issues.push('Ссылка организатора')
  if (!form.description?.trim()) issues.push('Описание')
  if (!intakes.length) issues.push('Сроки набора')
  else if (intakes.every((i) => i.mode === 'unknown' && !i.deadline)) issues.push('Сроки набора')
  if (intakes.length && intakes[0].cost_state === 'unknown') issues.push('Стоимость')
  return issues
}

function shiftDate(iso: string, days: number): string {
  const d = parseDateOnly(iso)
  d.setDate(d.getDate() - days)
  return d.toLocaleDateString('en-CA')
}

/**
 * Типовые шаги → личный план с датами: «за N дней до дедлайна организатора»
 * или, без дедлайна, «через N дней после добавления в план».
 * Дата в прошлом сдвигается на сегодня — иначе шаг родится просроченным.
 */
export function stepsFromTemplate(template: TemplateStep[], deadline: string | null | undefined, today: string = new Date().toLocaleDateString('en-CA')): StepInput[] {
  return template.map((t) => {
    // Без дедлайна («Принимают постоянно», «В своём темпе») срок считаем от сегодняшнего дня.
    const due = deadline
      ? t.days_before_deadline !== null ? shiftDate(deadline, t.days_before_deadline) : null
      : t.days_after_start != null ? shiftDate(today, -t.days_after_start) : null
    return { title: t.title, description: t.description, expected_result: t.expected_result, priority: t.priority,
      requires_review: t.requires_review, requires_evidence: t.requires_evidence, subtasks: [...t.subtasks],
      due_date: due && due < today ? today : due }
  })
}

const step = (title: string, days: number | null, extra: Partial<TemplateStep> = {}): TemplateStep => ({
  title, description: '', expected_result: '', priority: 'required', requires_review: false, requires_evidence: false, days_before_deadline: days, subtasks: [], ...extra,
})

/** Заготовки шагов по типу опыта — чтобы не писать одно и то же с нуля. */
export const TEMPLATE_PRESETS: Record<ExperienceKey, TemplateStep[]> = {
  competitions: [step('Зарегистрироваться у организатора', 30, { requires_evidence: true, expected_result: 'Скриншот или письмо о регистрации' }), step('Разобрать задания прошлых лет', 14), step('Принять участие', 0), step('Сохранить результат или диплом', null, { priority: 'recommended' })],
  research: [step('Выбрать тему и обсудить с ментором', 45, { requires_review: true }), step('Подготовить черновик работы', 20, { requires_review: true, requires_evidence: true }), step('Оформить и подать работу', 3, { requires_evidence: true })],
  programs: [step('Проверить требования и собрать документы', 30), step('Написать мотивационное письмо', 14, { requires_review: true, requires_evidence: true }), step('Подать заявку', 2, { requires_evidence: true, expected_result: 'Подтверждение подачи' })],
  courses: [step('Записаться на курс', null, { requires_evidence: true }), step('Пройти основные модули', null), step('Сдать итоговое задание', null, { requires_evidence: true })],
  internships: [step('Обновить резюме', 21, { requires_review: true, requires_evidence: true }), step('Отправить отклик', 7, { requires_evidence: true }), step('Подготовиться к собеседованию', null)],
  social: [step('Выбрать проект и роль', 30), step('Провести активность', null), step('Собрать подтверждение участия', null, { requires_evidence: true })],
  other: [step('Зарегистрироваться', 14), step('Выполнить задание', 3)],
}
