import { describe, expect, it } from 'vitest'
import type { WorkspaceRoadmapTask } from '@/api/workspace'
import type { StudentTask } from '@/types'
import {
  applyBaseFilter,
  bucketOf,
  countBuckets,
  filterByBucket,
  fromDelegated,
  fromRoadmap,
  relativeDue,
  rollupByStudent,
  sortItems,
} from './workItems'

// Среда 30 сентября 2026, полдень по локальному времени.
const TODAY = new Date(2026, 8, 30, 12, 0, 0)

const roadmap = (over: Partial<WorkspaceRoadmapTask> = {}): WorkspaceRoadmapTask => ({
  id: 'r1',
  student_id: 's1',
  student_name: 'Алимов Бекзат',
  roadmap_id: 'rm1',
  stage_name: 'Onboarding',
  stage_position: 0,
  title: 'Онбординг',
  status: 'planned',
  priority: 'recommended',
  audience: 'applicant',
  due_date: null,
  needs_document: false,
  needs_zoom: false,
  has_questionnaire: false,
  questionnaire_url: null,
  subtasks_total: 0,
  subtasks_done: 0,
  position: 0,
  review_status: 'none',
  completed_at: null,
  reviewed_at: null,
  review_comment: null,
  ...over,
})

const delegated = (over: Partial<StudentTask> = {}): StudentTask => ({
  id: 'd1',
  student_id: 's1',
  student_name: 'Алимов Бекзат',
  task_text: 'Собрать документы',
  status: 'open',
  created_by: 'u1',
  created_at: '2026-09-01T00:00:00Z',
  ...over,
})

describe('статус roadmap-шага', () => {
  it('заявка студента на проверку важнее статуса «в работе»', () => {
    const item = fromRoadmap(roadmap({ status: 'in_progress', review_status: 'pending' }), TODAY)
    expect(item.status).toBe('review')
  })

  it('возвращённый шаг показывается как «на доработке»', () => {
    expect(fromRoadmap(roadmap({ review_status: 'returned' }), TODAY).status).toBe('revision')
  })

  it('закрытый шаг не бывает просроченным', () => {
    const item = fromRoadmap(roadmap({ status: 'done', due_date: '2026-09-01' }), TODAY)
    expect(item.overdueDays).toBe(0)
    expect(bucketOf(item, TODAY)).toBe('none')
  })
})

describe('срок и просрочка', () => {
  it('срок сегодня — ещё не просрочка', () => {
    const item = fromRoadmap(roadmap({ due_date: '2026-09-30' }), TODAY)
    expect(item.overdueDays).toBe(0)
    expect(bucketOf(item, TODAY)).toBe('today')
    expect(relativeDue(item, TODAY)).toBe('сегодня')
  })

  it('вчерашний срок — просрочено на 1 день', () => {
    const item = fromRoadmap(roadmap({ due_date: '2026-09-29' }), TODAY)
    expect(item.overdueDays).toBe(1)
    expect(bucketOf(item, TODAY)).toBe('overdue')
    expect(relativeDue(item, TODAY)).toBe('просрочено на 1 день')
  })

  it('склонение: 2 дня, 5 дней, 21 день', () => {
    const at = (due: string) => relativeDue(fromRoadmap(roadmap({ due_date: due }), TODAY), TODAY)
    expect(at('2026-09-28')).toBe('просрочено на 2 дня')
    expect(at('2026-09-25')).toBe('просрочено на 5 дней')
    expect(at('2026-09-09')).toBe('просрочено на 21 день')
  })

  it('граница недели: +7 дней — неделя, +8 — позже', () => {
    expect(bucketOf(fromRoadmap(roadmap({ due_date: '2026-10-07' }), TODAY), TODAY)).toBe('week')
    expect(bucketOf(fromRoadmap(roadmap({ due_date: '2026-10-08' }), TODAY), TODAY)).toBe('later')
  })

  it('без срока — отдельная корзина', () => {
    expect(bucketOf(fromRoadmap(roadmap(), TODAY), TODAY)).toBe('none')
  })

  it('поручение, помеченное просроченным по SLA, не выглядит «в срок»', () => {
    const item = fromDelegated(delegated({ sla_overdue: true, sla_due_at: '2026-09-30T20:00:00Z' }), TODAY)
    expect(item.overdueDays).toBeGreaterThan(0)
    expect(bucketOf(item, TODAY)).toBe('overdue')
  })

  it('поручение в ожидании подписи регламента не горит', () => {
    const item = fromDelegated(delegated({ status: 'awaiting_signature', due_date: '2026-09-01' }), TODAY)
    expect(item.blocked).toBe(true)
    expect(item.overdueDays).toBe(0)
  })

  it('принятое и отменённое поручение не просрочено', () => {
    expect(fromDelegated(delegated({ status: 'accepted', due_date: '2026-09-01' }), TODAY).overdueDays).toBe(0)
    expect(fromDelegated(delegated({ status: 'cancelled', due_date: '2026-09-01' }), TODAY).overdueDays).toBe(0)
  })
})

describe('сортировка по сроку', () => {
  const items = [
    fromRoadmap(roadmap({ id: 'a', due_date: null }), TODAY),
    fromRoadmap(roadmap({ id: 'b', due_date: '2026-10-05' }), TODAY),
    fromRoadmap(roadmap({ id: 'c', due_date: '2026-09-20' }), TODAY),
  ]

  it('по возрастанию: просроченное первым, без срока последним', () => {
    expect(sortItems(items, 'due', 'asc').map((i) => i.id)).toEqual(['c', 'b', 'a'])
  })

  it('по убыванию «без срока» всё равно остаётся в конце', () => {
    expect(sortItems(items, 'due', 'desc').map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('при равном сроке важное выше', () => {
    const tied = [
      fromRoadmap(roadmap({ id: 'low', due_date: '2026-10-01', priority: 'optional' }), TODAY),
      fromRoadmap(roadmap({ id: 'high', due_date: '2026-10-01', priority: 'required' }), TODAY),
    ]
    expect(sortItems(tied, 'due', 'asc').map((i) => i.id)).toEqual(['high', 'low'])
  })
})

describe('фильтры и счётчики', () => {
  const items = [
    fromRoadmap(roadmap({ id: 'a', due_date: '2026-09-20', student_name: 'Алимов Бекзат' }), TODAY),
    fromRoadmap(roadmap({ id: 'b', due_date: '2026-09-30', student_name: 'Касымова Томирис', student_id: 's2' }), TODAY),
    fromDelegated(delegated({ id: 'c', task_text: 'Позвонить родителям' }), TODAY),
  ]

  it('поиск идёт и по названию, и по имени студента', () => {
    expect(applyBaseFilter(items, { query: 'касымова', kind: 'all' }).map((i) => i.id)).toEqual(['b'])
    expect(applyBaseFilter(items, { query: 'родител', kind: 'all' }).map((i) => i.id)).toEqual(['c'])
  })

  it('фильтр по типу', () => {
    expect(applyBaseFilter(items, { query: '', kind: 'delegated' }).map((i) => i.id)).toEqual(['c'])
  })

  it('счётчики сходятся с выдачей по корзине', () => {
    const counts = countBuckets(items, TODAY)
    expect(counts).toMatchObject({ all: 3, overdue: 1, today: 1, none: 1 })
    expect(filterByBucket(items, 'overdue', TODAY).map((i) => i.id)).toEqual(['a'])
  })
})

describe('сводка по студентам', () => {
  it('считает открытые, просроченные и ближайший срок; закрытые не учитывает', () => {
    const items = [
      fromRoadmap(roadmap({ id: 'a', due_date: '2026-09-20' }), TODAY),
      fromRoadmap(roadmap({ id: 'b', due_date: '2026-10-05', review_status: 'pending' }), TODAY),
      fromRoadmap(roadmap({ id: 'c', status: 'done', due_date: '2026-09-01' }), TODAY),
    ]
    expect(rollupByStudent(items)).toEqual([
      { studentId: 's1', studentName: 'Алимов Бекзат', open: 2, overdue: 1, review: 1, nextDue: '2026-09-20' },
    ])
  })
})
