import type { WorkspaceStudentSummary } from '@/api/workspace'

// Что сейчас важно по студенту. Одни и те же правила читают список студентов,
// панель справа и «Обзор» — иначе в списке «встреча сегодня», а на главной
// тот же человек числится «без roadmap», и ментор не понимает, кому верить.

export type MeetingWhen = 'today' | 'tomorrow' | 'later'
export type AttentionTone = 'danger' | 'accent' | 'none'

export interface StudentSignal {
  key: string
  label: string
  href: string
  /** danger — ждёт действия ментора; info — недонастроенная карточка. */
  tone: 'danger' | 'info'
}

// Коды из workspace.py (_student_summary). roadmap_missing и next_meeting_missing
// не показываем: об этом уже говорят блок roadmap и «Ближайшее».
const WARNING_LABELS: Record<string, { label: string; tab: string }> = {
  portal_access_missing: { label: 'Нет доступа в личный кабинет', tab: '#access' },
  primary_mentor_missing: { label: 'Не назначен основной ментор', tab: '' },
  telegram_missing: { label: 'Telegram не привязан', tab: '#telegram' },
}

const DAY = 86_400_000

function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function meetingWhen(startsAt: string | null | undefined, now = new Date()): MeetingWhen | null {
  if (!startsAt) return null
  const start = new Date(startsAt)
  if (Number.isNaN(start.getTime())) return null
  const diff = dayStart(start) - dayStart(now)
  if (diff < 0) return null
  if (diff === 0) return 'today'
  if (diff === DAY) return 'tomorrow'
  return 'later'
}

export function meetingTime(startsAt: string) {
  return new Date(startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function studentSignals(item: WorkspaceStudentSummary): StudentSignal[] {
  const base = `/workspace/students/${item.student.id}`
  const signals: StudentSignal[] = []
  const docs = item.documents?.unverified ?? 0
  const telegram = item.telegram?.pending_signals ?? 0
  const drafts = item.notes?.ai_drafts ?? 0
  if (docs > 0) signals.push({ key: 'documents', tone: 'danger', label: `${docs} ${plural(docs, 'документ ждёт', 'документа ждут', 'документов ждут')} проверки`, href: `${base}#documents` })
  if (telegram > 0) signals.push({ key: 'telegram', tone: 'danger', label: `${telegram} ${plural(telegram, 'сигнал', 'сигнала', 'сигналов')} из Telegram`, href: `${base}#telegram` })
  if (drafts > 0) signals.push({ key: 'drafts', tone: 'danger', label: `${drafts} ${plural(drafts, 'черновик конспекта', 'черновика конспекта', 'черновиков конспекта')}`, href: `${base}#notes` })
  for (const code of item.warnings ?? []) {
    const known = WARNING_LABELS[code]
    if (known) signals.push({ key: code, tone: 'info', label: known.label, href: `${base}${known.tab}` })
  }
  return signals
}

export function hasRoadmap(item: WorkspaceStudentSummary) {
  return Boolean(item.roadmap?.id)
}

export function isMeetingSoon(item: WorkspaceStudentSummary, now = new Date()) {
  const when = meetingWhen(item.next_meeting?.starts_at, now)
  return when === 'today' || when === 'tomorrow'
}

export function needsAttention(item: WorkspaceStudentSummary) {
  return !hasRoadmap(item) || studentSignals(item).some((signal) => signal.tone === 'danger')
}

/** Одна строка под именем: самое важное, а не всё подряд. */
export function studentHeadline(item: WorkspaceStudentSummary, now = new Date()): { text: string; tone: AttentionTone } {
  const meeting = item.next_meeting
  const when = meetingWhen(meeting?.starts_at, now)
  if (meeting && when === 'today') return { text: `встреча сегодня в ${meetingTime(meeting.starts_at)}`, tone: 'accent' }
  if (meeting && when === 'tomorrow') return { text: `встреча завтра в ${meetingTime(meeting.starts_at)}`, tone: 'accent' }
  if (!hasRoadmap(item)) return { text: 'нет roadmap', tone: 'danger' }
  const urgent = studentSignals(item).find((signal) => signal.tone === 'danger')
  if (urgent) return { text: urgent.label, tone: 'danger' }
  const tasks = item.open_roadmap_tasks
  if (tasks > 0) return { text: `прогресс ${item.roadmap.progress}% · ${tasks} ${plural(tasks, 'задача', 'задачи', 'задач')}`, tone: 'none' }
  return { text: item.student.portal_email || item.student.phone || 'контакт не указан', tone: 'none' }
}

export function attentionTone(item: WorkspaceStudentSummary): AttentionTone {
  if (needsAttention(item)) return 'danger'
  if (isMeetingSoon(item)) return 'accent'
  return 'none'
}

/** Меньше — выше в списке: сегодняшняя встреча, затем проблемы, затем завтра. */
export function urgencyRank(item: WorkspaceStudentSummary, now = new Date()) {
  const when = meetingWhen(item.next_meeting?.starts_at, now)
  if (when === 'today') return 0
  if (needsAttention(item)) return 1
  if (when === 'tomorrow') return 2
  return 3
}

export function sortByUrgency(items: WorkspaceStudentSummary[], now = new Date()) {
  return [...items].sort((a, b) =>
    urgencyRank(a, now) - urgencyRank(b, now)
    || (a.next_meeting?.starts_at ?? '~').localeCompare(b.next_meeting?.starts_at ?? '~')
    || a.student.full_name.localeCompare(b.student.full_name, 'ru'))
}

export interface Focus {
  kind: 'incident' | 'overdue' | 'review' | 'roadmap'
  title: string
  description: string
  action: string
  href: string
  people?: string[]
}

/** Главная проблема дня: просрочка важнее проверки, проверка — важнее roadmap. */
export function pickFocus({ incidents = 0, overdue, review, withoutRoadmap }: { incidents?: number; overdue: number; review: number; withoutRoadmap: string[] }): Focus | null {
  if (incidents > 0) return { kind: 'incident', title: `${incidents} ${plural(incidents, 'открытый инцидент', 'открытых инцидента', 'открытых инцидентов')}`, description: 'Инцидент безопасности требует разбора.', action: 'Открыть', href: '/workspace/security-incidents' }
  if (overdue > 0) return { kind: 'overdue', title: `${overdue} ${plural(overdue, 'задача просрочена', 'задачи просрочены', 'задач просрочено')}`, description: 'Сроки уже прошли — разберите их первыми.', action: 'Открыть задачи', href: '/workspace/tasks' }
  if (review > 0) return { kind: 'review', title: `${review} ${plural(review, 'работа ждёт', 'работы ждут', 'работ ждут')} проверки`, description: 'Студенты сдали задания и ждут вашего ответа.', action: 'Проверить', href: '/workspace/review' }
  const n = withoutRoadmap.length
  if (n > 0) return { kind: 'roadmap', title: `${n} ${plural(n, 'студенту', 'студентам', 'студентам')} не назначен roadmap`, description: 'Пока roadmap нет, задачи, дедлайны и проверки не появятся.', action: 'Назначить roadmap', href: '/workspace/students', people: withoutRoadmap }
  return null
}

/** «через 25 мин», «идёт сейчас», «сегодня в 14:55», «завтра в 10:00». */
export function meetingCountdown(startsAt: string, now = new Date()) {
  const minutes = Math.round((new Date(startsAt).getTime() - now.getTime()) / 60_000)
  if (minutes <= 0 && minutes > -60) return { text: 'идёт сейчас', live: true }
  if (minutes > 0 && minutes < 60) return { text: `через ${minutes} мин`, live: minutes <= 10 }
  const when = meetingWhen(startsAt, now)
  if (when === 'today') {
    const hours = Math.floor(minutes / 60), rest = minutes % 60
    return { text: `сегодня в ${meetingTime(startsAt)} · через ${hours} ч${rest ? ` ${rest} мин` : ''}`, live: false }
  }
  if (when === 'tomorrow') return { text: `завтра в ${meetingTime(startsAt)}`, live: false }
  return { text: new Date(startsAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), live: false }
}
