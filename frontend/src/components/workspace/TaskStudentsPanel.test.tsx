import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { TaskStudentsPanel } from './TaskStudentsPanel'

const mk = (i: number, open = 0): WorkspaceStudentSummary => ({
  student: { id: `s${i}`, full_name: `Студент ${i}` },
  open_roadmap_tasks: open,
  open_internal_tasks: 0,
}) as unknown as WorkspaceStudentSummary

const render_ = (students: WorkspaceStudentSummary[], canCreate = true, onCreate = vi.fn()) => {
  render(<MemoryRouter><TaskStudentsPanel students={students} canCreate={canCreate} onCreate={onCreate} /></MemoryRouter>)
  return onCreate
}

describe('TaskStudentsPanel', () => {
  it('показывает и студента без задач, и с задачами', () => {
    render_([mk(1, 0), mk(2, 3)])
    expect(screen.getByText('Задач нет')).toBeInTheDocument()
    expect(screen.getByText('Открытых задач: 3')).toBeInTheDocument()
  })

  it('«+ Задача» передаёт выбранного студента', () => {
    const onCreate = render_([mk(1), mk(2)])
    fireEvent.click(screen.getByRole('button', { name: 'Поставить задачу: Студент 2' }))
    expect(onCreate).toHaveBeenCalledWith({ id: 's2', name: 'Студент 2' })
  })

  it('без права кнопок нет', () => {
    render_([mk(1)], false)
    expect(screen.queryByRole('button', { name: /Поставить задачу/ })).toBeNull()
  })

  it('больше 8 студентов: свёрнуто, поиск и «показать всех»', () => {
    render_(Array.from({ length: 12 }, (_, i) => mk(i + 1)))
    expect(screen.queryByText('Студент 12')).toBeNull()
    fireEvent.click(screen.getByText(/Показать всех/))
    expect(screen.getByText('Студент 12')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Найти студента'), { target: { value: 'студент 11' } })
    expect(screen.getByText('Студент 11')).toBeInTheDocument()
    expect(screen.queryByText('Студент 2')).toBeNull()
  })

  it('пустой список — панели нет', () => {
    const { container } = render(<MemoryRouter><TaskStudentsPanel students={[]} canCreate onCreate={vi.fn()} /></MemoryRouter>)
    expect(container.firstChild).toBeNull()
  })
})
