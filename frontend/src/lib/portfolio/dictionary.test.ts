import { describe, expect, it } from 'vitest'
import { EXPERIENCE_TYPES, SHELF_TYPES, formatDue, formatPast, participationStage, stepStatus, needsPlan } from './dictionary'

const today = new Date(2026, 9, 22)

describe('formatDue', () => {
  it('в пределах недели пишет словами', () => {
    expect(formatDue('2026-10-22', today)).toBe('сегодня')
    expect(formatDue('2026-10-23', today)).toBe('завтра')
    expect(formatDue('2026-10-26', today)).toBe('через 4 дня')
    expect(formatDue('2026-10-29', today)).toBe('через 7 дней')
    expect(formatDue('2026-10-21', today)).toBe('просрочено на 1 день')
    expect(formatDue('2026-10-18', today)).toBe('просрочено на 4 дня')
  })
  it('дальше датой, год только если другой', () => {
    expect(formatDue('2026-11-05', today)).toMatch(/^5 нояб/)
    expect(formatDue('2026-11-05', today)).not.toMatch(/2026/)
    expect(formatDue('2027-03-15', today)).toMatch(/^15 мар.*2027/)
  })
  it('прошедшее', () => {
    expect(formatPast('2026-10-21T09:00:00Z', today)).toBe('вчера')
    expect(formatPast('2026-10-19', today)).toBe('3 дня назад')
  })
})

describe('статусы', () => {
  it('шаг: закрыт сам или принят ментором одинаково «Готово»', () => {
    expect(stepStatus({ status: 'done', review_status: 'approved' })).toBe('done')
    expect(stepStatus({ status: 'done', review_status: 'none' })).toBe('done')
    expect(stepStatus({ status: 'todo', review_status: 'pending' })).toBe('pending')
    expect(stepStatus({ status: 'todo', review_status: 'returned' })).toBe('returned')
    expect(stepStatus({ status: 'in_progress', review_status: 'none' })).toBe('todo')
  })
  it('участие: рекомендация → в работе → итог на проверке → достижение', () => {
    expect(participationStage({ decision: 'suggested', status: 'not_started' })).toBe('recommendation')
    expect(participationStage({ decision: 'selected', status: 'not_started' })).toBe('in_work')
    expect(participationStage({ decision: 'selected', status: 'in_progress', result_review_status: 'pending' })).toBe('result_review')
    expect(participationStage({ decision: 'selected', status: 'completed' })).toBe('achievement')
    expect(participationStage({ decision: 'not_interested', status: 'not_started' })).toBe('declined')
    expect(needsPlan({ decision: 'selected', status: 'not_started', steps: undefined })).toBe(true)
  })
  it('полка из шести типов, без «Другое»', () => {
    expect(SHELF_TYPES).toHaveLength(6)
    expect(EXPERIENCE_TYPES.map((t) => t.label)).toContain('Программы и школы')
  })
})
