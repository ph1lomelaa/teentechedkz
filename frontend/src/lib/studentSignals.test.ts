import { describe, expect, it } from 'vitest'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { isMeetingSoon, meetingCountdown, meetingWhen, needsAttention, pickFocus, sortByUrgency, studentHeadline, studentSignals } from './studentSignals'

const NOW = new Date('2026-10-03T12:00:00')
const at = (days: number, hour = 15) => { const d = new Date(NOW); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString() }

function student(id: string, over: Partial<WorkspaceStudentSummary> = {}): WorkspaceStudentSummary {
  return {
    student: { id, full_name: `Студент ${id}`, degree_level: 'bachelor', intake_year: 2026, has_portal_access: false, phone: '+7 700 000 00 00' },
    primary_mentor: null, my_roles: ['lead'],
    roadmap: { id: 'r', name: 'США', country_name: null, year: 2026, tasks_total: 10, tasks_done: 4, progress: 40 },
    open_roadmap_tasks: 6, open_internal_tasks: 0, next_meeting: null,
    documents: { total: 0, unverified: 0 }, telegram: { linked: false, pending_signals: 0 }, notes: { sessions: 0, ai_drafts: 0 }, warnings: [],
    ...over,
  } as WorkspaceStudentSummary
}
const meeting = (days: number) => ({ id: 'm', title: 'Разбор', starts_at: at(days), meeting_link: '' })

describe('meetingWhen', () => {
  it('различает сегодня, завтра и позже, прошлое — null', () => {
    expect(meetingWhen(at(0), NOW)).toBe('today')
    expect(meetingWhen(at(1), NOW)).toBe('tomorrow')
    expect(meetingWhen(at(5), NOW)).toBe('later')
    expect(meetingWhen(at(-1), NOW)).toBeNull()
    expect(meetingWhen(null, NOW)).toBeNull()
  })
})

describe('studentHeadline', () => {
  it('встреча сегодня важнее отсутствия roadmap', () => {
    const s = student('a', { next_meeting: meeting(0), roadmap: { ...student('x').roadmap, id: null } })
    expect(studentHeadline(s, NOW)).toEqual({ text: 'встреча сегодня в 15:00', tone: 'accent' })
  })
  it('без встречи и roadmap — «нет roadmap»', () => {
    expect(studentHeadline(student('a', { roadmap: { ...student('x').roadmap, id: null } }), NOW).text).toBe('нет roadmap')
  })
  it('сигнал важнее прогресса, иначе прогресс с задачами', () => {
    expect(studentHeadline(student('a', { documents: { total: 3, unverified: 2 } }), NOW).text).toBe('2 документа ждут проверки')
    expect(studentHeadline(student('a'), NOW).text).toBe('прогресс 40% · 6 задач')
  })
})

describe('сортировка и фильтры', () => {
  it('сегодняшняя встреча, затем внимание, затем завтра, затем остальные', () => {
    const items = [student('calm'), student('tomorrow', { next_meeting: meeting(1) }), student('noRoadmap', { roadmap: { ...student('x').roadmap, id: null } }), student('today', { next_meeting: meeting(0) })]
    expect(sortByUrgency(items, NOW).map((i) => i.student.id)).toEqual(['today', 'noRoadmap', 'tomorrow', 'calm'])
  })
  it('внимание и «встреча скоро» считаются по тем же правилам', () => {
    expect(needsAttention(student('n', { roadmap: { ...student('x').roadmap, id: null } }))).toBe(true)
    expect(isMeetingSoon(student('t', { next_meeting: meeting(1) }), NOW)).toBe(true)
    expect(isMeetingSoon(student('t', { next_meeting: meeting(4) }), NOW)).toBe(false)
  })
  it('сигналы ведут на нужные вкладки карточки', () => {
    const s = student('z', { telegram: { linked: true, pending_signals: 1 }, notes: { sessions: 1, ai_drafts: 3 } })
    expect(studentSignals(s).map((x) => [x.label, x.href])).toEqual([
      ['1 сигнал из Telegram', '/workspace/students/z#telegram'],
      ['3 черновика конспекта', '/workspace/students/z#notes'],
    ])
  })
})

describe('предупреждения карточки', () => {
  it('коды переводятся по-русски, дубли roadmap/встречи скрыты, внимания не требуют', () => {
    const s = student('w', { warnings: ['portal_access_missing', 'roadmap_missing', 'telegram_missing', 'next_meeting_missing', 'unknown_code'] })
    expect(studentSignals(s).map((x) => [x.label, x.href, x.tone])).toEqual([
      ['Нет доступа в личный кабинет', '/workspace/students/w#access', 'info'],
      ['Telegram не привязан', '/workspace/students/w#telegram', 'info'],
    ])
    expect(needsAttention(s)).toBe(false)
    expect(studentHeadline(s, NOW).text).toBe('прогресс 40% · 6 задач')
  })
})

describe('meetingCountdown', () => {
  const in_ = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString()
  it('говорит по-человечески и подсвечивает близкое', () => {
    expect(meetingCountdown(in_(-15), NOW)).toEqual({ text: 'идёт сейчас', live: true })
    expect(meetingCountdown(in_(8), NOW)).toEqual({ text: 'через 8 мин', live: true })
    expect(meetingCountdown(in_(40), NOW)).toEqual({ text: 'через 40 мин', live: false })
    expect(meetingCountdown(in_(150), NOW).text).toBe('сегодня в 14:30 · через 2 ч 30 мин')
    expect(meetingCountdown(at(1), NOW).text).toBe('завтра в 15:00')
  })
})

describe('pickFocus', () => {
  it('инцидент → просрочка → проверка → roadmap → ничего', () => {
    expect(pickFocus({ incidents: 1, overdue: 2, review: 5, withoutRoadmap: ['А'] })?.kind).toBe('incident')
    expect(pickFocus({ overdue: 2, review: 5, withoutRoadmap: ['А'] })?.kind).toBe('overdue')
    expect(pickFocus({ overdue: 0, review: 1, withoutRoadmap: ['А'] })?.title).toBe('1 работа ждёт проверки')
    expect(pickFocus({ overdue: 0, review: 0, withoutRoadmap: ['А', 'Б'] })).toMatchObject({ kind: 'roadmap', title: '2 студентам не назначен roadmap', people: ['А', 'Б'] })
    expect(pickFocus({ overdue: 0, review: 0, withoutRoadmap: [] })).toBeNull()
  })
})
