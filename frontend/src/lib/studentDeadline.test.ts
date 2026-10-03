import { describe, expect, it } from 'vitest'
import { studentDueText, studentOverdueDays } from './studentDeadline'

const year = new Date().getFullYear()

describe('studentDueText', () => {
  it('без срока', () => {
    expect(studentDueText({ due_date: null }, false)).toBe('без дедлайна')
  })

  it('срок в будущем — только дата, без года в текущем году', () => {
    const text = studentDueText({ due_date: `${year + 1}-06-10`, overdue_days: 0 }, false)
    expect(text).toMatch(/^дедлайн 10 июн\./)
    expect(text).not.toContain('просрочено')
  })

  it('просрочка берётся у бэкенда, а не считается заново', () => {
    const text = studentDueText({ due_date: `${year}-01-05`, overdue_days: 6 }, false)
    expect(text).toContain('просрочено на 6 дн.')
  })

  it('выполненная задача не бывает просроченной', () => {
    const task = { due_date: `${year}-01-05`, overdue_days: 6 }
    expect(studentOverdueDays(task, true)).toBe(0)
    expect(studentDueText(task, true)).not.toContain('просрочено')
  })
})
