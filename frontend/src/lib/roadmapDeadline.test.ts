import { describe, expect, it } from 'vitest'
import { formatDeadline, isLaterThanTask, overdueDaysOf, sortSubtasksByDeadline } from './roadmapDeadline'

const today = new Date(2026, 9, 10)

describe('overdueDaysOf', () => {
  it('считает дни просрочки у невыполненного', () => {
    expect(overdueDaysOf({ due_date: '2026-10-07' }, false, today)).toBe(3)
  })
  it('выполненное и без срока не просрочено', () => {
    expect(overdueDaysOf({ due_date: '2026-10-07' }, true, today)).toBe(0)
    expect(overdueDaysOf({ due_date: null }, false, today)).toBe(0)
  })
  it('срок сегодня и в будущем — не просрочка', () => {
    expect(overdueDaysOf({ due_date: '2026-10-10' }, false, today)).toBe(0)
    expect(overdueDaysOf({ due_date: '2026-10-20' }, false, today)).toBe(0)
  })
  it('доверяет значению бэка (зона компании)', () => {
    expect(overdueDaysOf({ due_date: '2026-10-09', overdue_days: 0 }, false, today)).toBe(0)
  })
})

describe('isLaterThanTask / сортировка / формат', () => {
  it('подзадача позже задачи — предупреждение, равный срок — нет', () => {
    expect(isLaterThanTask('2026-10-20', '2026-10-15')).toBe(true)
    expect(isLaterThanTask('2026-10-15', '2026-10-15')).toBe(false)
    expect(isLaterThanTask(null, '2026-10-15')).toBe(false)
    expect(isLaterThanTask('2026-10-20', null)).toBe(false)
  })
  it('сортирует по сроку, без срока в конец', () => {
    const subs = [
      { id: 'a', due_date: null, position: 0 },
      { id: 'b', due_date: '2026-10-20', position: 1 },
      { id: 'c', due_date: '2026-10-05', position: 2 },
      { id: 'd', due_date: null, position: 3 },
    ]
    expect(sortSubtasksByDeadline(subs).map((s) => s.id)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('короткая дата без года в текущем году', () => {
    expect(formatDeadline('2026-10-15', today)).toBe('15 окт.')
    expect(formatDeadline('2027-01-05', today)).toContain('2027')
  })
})
