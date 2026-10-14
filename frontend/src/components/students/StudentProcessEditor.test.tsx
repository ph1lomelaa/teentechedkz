import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentProcessEditor } from './StudentProcessEditor'
import { BaseStudentTable } from './base/BaseStudentTable'
import { MemoryRouter } from 'react-router-dom'
import type { StudentFull, StudentListItem } from '@/types'

const mocks = vi.hoisted(() => ({ update: vi.fn(), can: vi.fn(() => true), toast: vi.fn() }))
vi.mock('@/api/students', () => ({ studentsApi: { update: mocks.update } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: mocks.can }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }))
const student = { id: 's1', full_name: 'Student', degree_level: 'undergraduate', intake_year: 2026, pipeline_status: 'active_work' } as StudentFull
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><StudentProcessEditor student={student} workspace /></QueryClientProvider>)
  return invalidate
}
beforeEach(() => { vi.clearAllMocks(); mocks.can.mockReturnValue(true); mocks.update.mockResolvedValue({ ...student, intake_year: 2027, pipeline_status: 'completed_admitted' }) })
describe('Student process editing', () => {
  it('saves year and completed status together and refreshes both cards and lists', async () => {
    const invalidate = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить год и статус' }))
    fireEvent.change(screen.getByLabelText('Год поступления / набора'), { target: { value: '2027' } })
    fireEvent.change(screen.getByLabelText('Статус работы'), { target: { value: 'completed_admitted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить год и статус' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('s1', { intake_year: 2027, pipeline_status: 'completed_admitted' }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['students'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notion'] })
  })
  it('does not expose status changes without work status permission', () => {
    mocks.can.mockImplementation((...args: unknown[]) => args[0] === 'students')
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить год и статус' }))
    expect(screen.getByLabelText('Статус работы')).toBeDisabled()
  })
  it('does not save an empty year', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить год и статус' }))
    fireEvent.change(screen.getByLabelText('Год поступления / набора'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Сохранить год и статус' })).toBeDisabled()
  })
  it('shows platform status first when Notion still shows active work', () => {
    render(<MemoryRouter><BaseStudentTable groups={ [['Все', [{ ...student, pipeline_status: 'completed_admitted' } as StudentListItem]]] } selectedIds={new Set()} onToggle={vi.fn()} onSelectAll={vi.fn()} onOpen={vi.fn()} onRole={vi.fn()} onSelf={vi.fn()} canAssign={false} isManager={false} intakeOverview={{}} sortAscending onSort={vi.fn()} isLoading={false} onRetry={vi.fn()} selfPending={false} showCountries={false} showForms={false} showSelection={false} notionStatuses={new Map([['s1', 'Активная работа']])} notionStatusColors={new Map()} /></MemoryRouter>)
    expect(screen.getByText('Работа окончена — Поступил')).toBeInTheDocument()
    expect(screen.getByText('Notion:')).toBeInTheDocument()
    expect(screen.getByText('Активная работа')).toBeInTheDocument()
  })
})
