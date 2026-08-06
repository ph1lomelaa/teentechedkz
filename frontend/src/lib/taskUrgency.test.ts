import { describe, expect, it } from 'vitest'
import { taskUrgency } from './taskUrgency'

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
