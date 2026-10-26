import { describe, expect, it } from 'vitest'
import type { ActivityBoardData, BoardStudent } from '@/api/activities'
import { byActivity } from './boardGroups'

const student = (id: string, name: string, extra: Partial<BoardStudent> = {}): BoardStudent => ({ student_id: id, name, participation_id: `${id}-${name}`, step_index: 1, step_total: 2, step_done: 0, step_pending: 0, next_title: 'Шаг', due: null, overdue_days: 0, needs_me: false, ...extra })
const data: ActivityBoardData = {
  declined: 1, declined_students: [{ activity_id: 'late', student_id: 's9', name: 'Ира', participation_id: 'x' }],
  columns: [
    { key: 'recommendation', items: [{ activity_id: 'late', title: 'Поздняя', experience_type: 'research', submit_deadline: '2026-12-01', students: [student('s1', 'Алина')] }] },
    { key: 'in_work', items: [
      { activity_id: 'soon', title: 'Ранняя', experience_type: 'competitions', submit_deadline: '2026-11-01', students: [student('s2', 'Бекзат', { overdue_days: 2 })] },
      { activity_id: 'late', title: 'Поздняя', experience_type: 'research', submit_deadline: '2026-12-01', students: [student('s2', 'Бекзат', { needs_me: true })] }] },
    { key: 'result_review', items: [] }, { key: 'achievement', items: [] }],
}

describe('группировка доски', () => {
  it('колонки по активностям, по сроку подачи; внутри сначала «нужно от меня»', () => {
    const groups = byActivity(data)
    expect(groups.map((g) => g.activity_id)).toEqual(['soon', 'late'])
    expect(groups[1].entries.map((e) => [e.name, e.stage])).toEqual([['Бекзат', 'in_work'], ['Алина', 'recommendation']])
    expect(groups[1].declined).toHaveLength(1)
  })
})
