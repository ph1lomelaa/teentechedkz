import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeadlineField } from './DeadlineField'

describe('DeadlineField', () => {
  it('студент: только просмотр «до 15 окт.», без input', () => {
    render(<DeadlineField dueDate={`${new Date().getFullYear()}-10-15`} overdueDays={0} label="Срок" />)
    expect(screen.getByText('до 15 окт.')).toBeTruthy()
    expect(screen.queryByLabelText('Срок')).toBeNull()
  })

  it('студент без срока: ничего не рисуем', () => {
    const { container } = render(<DeadlineField dueDate={null} overdueDays={0} label="Срок" />)
    expect(container.firstChild).toBeNull()
  })

  it('сотрудник без срока: «+ срок» открывает date-input и сохраняет', () => {
    const onChange = vi.fn()
    render(<DeadlineField dueDate={null} overdueDays={0} onChange={onChange} label="Срок задачи" />)
    fireEvent.click(screen.getByText('+ срок'))
    fireEvent.change(screen.getByLabelText('Срок задачи'), { target: { value: '2026-11-01' } })
    expect(onChange).toHaveBeenCalledWith('2026-11-01')
  })

  it('просрочено: красная пометка «просрочено на N дн.»', () => {
    render(<DeadlineField dueDate="2026-10-01" overdueDays={9} label="Срок" />)
    expect(screen.getByTestId('overdue-badge').textContent).toBe('просрочено на 9 дн.')
  })

  it('не просрочено — пометки нет', () => {
    render(<DeadlineField dueDate="2026-10-01" overdueDays={0} label="Срок" />)
    expect(screen.queryByTestId('overdue-badge')).toBeNull()
  })

  it('подзадача позже задачи: предупреждение, но input не блокируется', () => {
    const onChange = vi.fn()
    render(<DeadlineField dueDate="2026-10-20" taskDueDate="2026-10-15" overdueDays={0} onChange={onChange} label="Срок подзадачи" />)
    expect(screen.getByTestId('later-warning').textContent).toBe('позже срока задачи')
    fireEvent.change(screen.getByLabelText('Срок подзадачи'), { target: { value: '2026-10-25' } })
    expect(onChange).toHaveBeenCalledWith('2026-10-25')
  })

  it('равный или более ранний срок — без предупреждения', () => {
    render(<DeadlineField dueDate="2026-10-15" taskDueDate="2026-10-15" overdueDays={0} label="Срок" />)
    expect(screen.queryByTestId('later-warning')).toBeNull()
  })
})
