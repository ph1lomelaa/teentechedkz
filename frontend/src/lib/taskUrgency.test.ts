import { describe, expect, it } from 'vitest'
import { isTaskLive, taskUrgency } from './taskUrgency'

describe('taskUrgency', () => {
  it('returns none when there is no due date', () => {
    expect(taskUrgency(null, 'open', new Date(2026, 0, 10))).toBe('none')
  })

  it('returns none when the task is done, even if overdue', () => {
    expect(taskUrgency('2026-01-01', 'done', new Date(2026, 0, 10))).toBe('none')
  })

  it('returns none when due date is today', () => {
    expect(taskUrgency('2026-01-10', 'open', new Date(2026, 0, 10))).toBe('none')
  })

  it('returns none when due date is in the future', () => {
    expect(taskUrgency('2026-01-15', 'open', new Date(2026, 0, 10))).toBe('none')
  })

  it('returns yellow one day overdue', () => {
    expect(taskUrgency('2026-01-09', 'open', new Date(2026, 0, 10))).toBe('yellow')
  })

  it('returns yellow at the upper boundary', () => {
    expect(taskUrgency('2026-01-08', 'open', new Date(2026, 0, 9))).toBe('yellow')
  })

  it('returns orange at the lower boundary', () => {
    expect(taskUrgency('2026-01-08', 'open', new Date(2026, 0, 10))).toBe('orange')
  })

  it('returns orange at the upper boundary', () => {
    expect(taskUrgency('2026-01-07', 'open', new Date(2026, 0, 9))).toBe('orange')
  })

  it('returns red at the lower boundary', () => {
    expect(taskUrgency('2026-01-07', 'open', new Date(2026, 0, 10))).toBe('red')
  })

  it('returns red at the upper boundary', () => {
    expect(taskUrgency('2026-01-06', 'open', new Date(2026, 0, 9))).toBe('red')
  })

  it('returns critical at the lower boundary', () => {
    expect(taskUrgency('2026-01-06', 'open', new Date(2026, 0, 10))).toBe('critical')
  })

  it('returns critical far overdue', () => {
    expect(taskUrgency('2025-01-01', 'open', new Date(2026, 0, 10))).toBe('critical')
  })
})

/**
 * Статус, а не даты. Раньше здесь не было ни одного такого теста: 12 проверок
 * покрывали только границы дат, поэтому расширение набора статусов прошло бы
 * незамеченным. Состав набора пришпилен на бэке (test_task_live_statuses.py),
 * здесь — что зеркало ведёт себя так же.
 */
describe('срочность и статус задачи', () => {
  const longAgo = '2026-08-01'
  const today = new Date(2026, 7, 31)

  it.each(['done', 'accepted', 'cancelled'])('закрытая задача не горит: %s', (status) => {
    expect(taskUrgency(longAgo, status, today)).toBe('none')
  })

  it.each(['awaiting_signature', 'blocked_by_agreement'])(
    'задача на паузе SLA не горит: %s',
    (status) => {
      expect(taskUrgency(longAgo, status, today)).toBe('none')
    },
  )

  it.each(['open', 'in_progress', 'submitted', 'needs_revision', 'overdue'])(
    'живая задача горит: %s',
    (status) => {
      expect(taskUrgency(longAgo, status, today)).toBe('critical')
    },
  )

  it('isTaskLive — дополнение к тому же набору', () => {
    expect(isTaskLive('overdue')).toBe(true)
    expect(isTaskLive('in_progress')).toBe(true)
    expect(isTaskLive('cancelled')).toBe(false)
    expect(isTaskLive('awaiting_signature')).toBe(false)
  })
})
