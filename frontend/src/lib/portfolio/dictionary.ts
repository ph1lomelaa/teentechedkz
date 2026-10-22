/**
 * Словарь Portfolio UP: все подписи раздела, статусы и даты в одном месте.
 * Экраны ученика и ментора берут слова только отсюда, чтобы одно и то же
 * состояние не называлось на разных страницах по-разному.
 *
 * Слово «ход» не используем: кто должен действовать, говорит форма «Нужно от …».
 */
import type { ExperienceKey, Participation } from '@/api/activities'
import { parseDateOnly } from '@/lib/roadmapDeadline'

// ---------------------------------------------------------------- термины

export const TERMS = {
  section: 'Portfolio UP',
  shelf: 'Полка',
  recommendation: 'Рекомендация',
  participation: 'Участие',
  participations: 'Участия',
  step: 'Шаг',
  checklist: 'Чеклист',
  result: 'Итог',
  file: 'Файл',
  achievement: 'Достижение',
  achievements: 'Достижения',
  declined: 'Не участвую',
  focus: 'Фокус',
  intake: 'Набор',
  now: 'Сейчас',
} as const

/** Кто должен действовать. `you`/`me` — тот, кто смотрит. */
export type NeedWho = 'you' | 'mentor' | 'student' | 'me' | 'organizer'

export const NEED_LABEL: Record<NeedWho, string> = {
  you: 'Нужно от вас',
  mentor: 'Нужно от ментора',
  student: 'Нужно от ученика',
  me: 'Нужно от меня',
  organizer: 'Ждём организатора',
}

export const BUTTONS = {
  addToPlan: 'Добавить в план',
  notInterested: 'Не интересно',
  recommend: 'Рекомендовать',
  addToStudentPlan: 'Добавить в план ученика',
  accept: 'Принять',
  returnWithComment: 'Вернуть с комментарием',
  confirmResult: 'Подтвердить итог',
  submitForReview: 'Отправить на проверку',
  backToPlan: 'Вернуть в план',
  pickActivity: 'Подобрать активность',
} as const

// ---------------------------------------------------------------- типы опыта

/** Ключи как на backend (app/services/experience.py), подписи одинаковые там и здесь. */
export const EXPERIENCE_TYPES: Array<{ key: ExperienceKey; label: string; short: string; code: string }> = [
  { key: 'competitions', label: 'Олимпиады и конкурсы', short: 'Олимпиады', code: 'Ол' },
  { key: 'research', label: 'Исследования и проекты', short: 'Исследования', code: 'Ис' },
  { key: 'programs', label: 'Программы и школы', short: 'Программы', code: 'Пр' },
  { key: 'courses', label: 'Курсы', short: 'Курсы', code: 'Ку' },
  { key: 'internships', label: 'Стажировки', short: 'Стажировки', code: 'Ст' },
  { key: 'social', label: 'Волонтёрство', short: 'Волонтёрство', code: 'Во' },
  { key: 'other', label: 'Другое', short: 'Другое', code: '' },
]

/** Шесть ячеек полки: «Другое» в полке не считается. */
export const SHELF_TYPES = EXPERIENCE_TYPES.filter((t) => t.key !== 'other')

export const EXPERIENCE_LABEL = Object.fromEntries(EXPERIENCE_TYPES.map((t) => [t.key, t.label])) as Record<ExperienceKey, string>

export function isExperienceKey(value: string | null | undefined): value is ExperienceKey {
  return EXPERIENCE_TYPES.some((t) => t.key === value)
}

// ---------------------------------------------------------------- статусы шага

export type StepStatus = 'todo' | 'pending' | 'returned' | 'done'
export type StatusTone = 'neutral' | 'info' | 'danger' | 'good'

export const STEP_STATUS: Record<StepStatus, { label: string; tone: StatusTone }> = {
  todo: { label: 'Предстоит', tone: 'neutral' },
  pending: { label: 'На проверке', tone: 'info' },
  returned: { label: 'Нужны правки', tone: 'danger' },
  done: { label: 'Готово', tone: 'good' },
}

/** Состояние шага по полям задачи: закрыт сам или принят ментором — одинаково «Готово». */
export function stepStatus(task: { status: string; review_status?: string | null }): StepStatus {
  if (task.status === 'done') return 'done'
  if (task.review_status === 'pending') return 'pending'
  if (task.review_status === 'returned') return 'returned'
  return 'todo'
}

// ---------------------------------------------------------------- статусы участия

export type ParticipationStage = 'recommendation' | 'in_work' | 'result_review' | 'achievement' | 'declined'

export const PARTICIPATION_STAGE: Record<ParticipationStage, { label: string; tone: StatusTone }> = {
  recommendation: { label: 'Рекомендация', tone: 'neutral' },
  in_work: { label: 'В работе', tone: 'neutral' },
  result_review: { label: 'Итог на проверке', tone: 'info' },
  achievement: { label: 'Достижение', tone: 'good' },
  declined: { label: 'Не участвую', tone: 'neutral' },
}

export function participationStage(item: Pick<Participation, 'decision' | 'status' | 'result_review_status'>): ParticipationStage {
  if (item.decision === 'not_interested' || item.status === 'cancelled') return 'declined'
  if (item.decision === 'suggested') return 'recommendation'
  if (item.status === 'completed' || item.result_review_status === 'approved') return 'achievement'
  if (item.result_review_status === 'pending') return 'result_review'
  return 'in_work'
}

/** Участие «В работе» без шагов: план ещё не составлен. */
export function needsPlan(item: Pick<Participation, 'decision' | 'status' | 'result_review_status' | 'steps'>): boolean {
  return participationStage(item) === 'in_work' && !item.steps?.total
}

// ---------------------------------------------------------------- даты

const DAY = 86_400_000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «22 окт.», в другом году «15 мар. 2027». */
export function formatDay(value: string, today: Date = new Date()): string {
  const date = parseDateOnly(value.slice(0, 10))
  return date.toLocaleDateString('ru-RU', date.getFullYear() === today.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Срок для списков и карточек. В пределах недели словами («сегодня»,
 * «завтра», «через 4 дня», «просрочено на 4 дня»), дальше датой.
 */
export function formatDue(value: string, today: Date = new Date()): string {
  const diff = Math.round((parseDateOnly(value.slice(0, 10)).getTime() - startOfDay(today).getTime()) / DAY)
  if (diff === 0) return 'сегодня'
  if (diff === 1) return 'завтра'
  if (diff > 1 && diff <= 7) return `через ${diff} ${plural(diff, 'день', 'дня', 'дней')}`
  if (diff < 0 && diff >= -7) return `просрочено на ${-diff} ${plural(-diff, 'день', 'дня', 'дней')}`
  return formatDay(value, today)
}

/** Для прошедших событий: «сегодня», «вчера», «3 дня назад», дальше датой. */
export function formatPast(value: string, today: Date = new Date()): string {
  const diff = Math.round((startOfDay(today).getTime() - parseDateOnly(value.slice(0, 10)).getTime()) / DAY)
  if (diff <= 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  if (diff < 7) return `${diff} ${plural(diff, 'день', 'дня', 'дней')} назад`
  return formatDay(value, today)
}

/** Режим набора без даты. */
export const INTAKE_MODE_LABEL = {
  rolling: 'Принимают постоянно',
  self_paced: 'В своём темпе',
} as const
