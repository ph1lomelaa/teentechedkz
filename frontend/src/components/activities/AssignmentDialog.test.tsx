import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { AssignmentDialog } from './AssignmentDialog'
import type { Activity, Intake } from '@/api/activities'
const mocks = vi.hoisted(() => ({ staffStudents: vi.fn(), assign: vi.fn(), template: vi.fn() }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
const activity = { id: 'a1', title: 'Олимпиада', publication: 'published' } as Activity
const intakes = [{ id: 'i1', label: 'Осень', deadline: null, mode: 'rolling', cost_state: 'free' }] as Intake[]
function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter><AssignmentDialog activity={activity} intakes={intakes} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.clearAllMocks(); mocks.template.mockResolvedValue([]); mocks.staffStudents.mockResolvedValue([{ id: 's1', name: 'Алина' }, { id: 's2', name: 'Бекзат' }]); mocks.assign.mockResolvedValue({ results: [{ student_id: 's1', status: 'created' }, { student_id: 's2', status: 'error', message: 'Набор закрыт' }] }) })
it('индивидуальный план независим от последующих изменений общей заготовки', async () => {
  open()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Алина' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Бекзат' }))
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }))
  expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Что сделать'), { target: { value: 'Регистрация' } })
  fireEvent.change(screen.getByLabelText('Чьи шаги'), { target: { value: 's1' } })
  fireEvent.change(screen.getByLabelText('Срок'), { target: { value: '2030-11-01' } })
  fireEvent.click(screen.getByText('Описание, проверка и подтверждения'))
  fireEvent.click(screen.getByLabelText(/Нужна проверка ментора/))
  fireEvent.change(screen.getByLabelText('Чьи шаги'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Что сделать'), { target: { value: 'Регистрация и анкета' } })
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: 'Назначить · 2' }))
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1))
  const payload = mocks.assign.mock.calls[0][0]
  expect(payload.recipients[0].steps[0]).toMatchObject({ title: 'Регистрация', due_date: '2030-11-01', requires_review: true })
  expect(payload.recipients[1].steps[0]).toMatchObject({ title: 'Регистрация и анкета', due_date: null, requires_review: false })
  expect(await screen.findByText('Набор закрыт')).toBeInTheDocument()
  mocks.assign.mockResolvedValue({ results: [{ student_id: 's2', status: 'created' }] })
  fireEvent.click(screen.getByRole('button', { name: 'Повторить для учеников с ошибкой' }))
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2))
  expect(mocks.assign.mock.calls[1][0].recipients.map((r: { student_id: string }) => r.student_id)).toEqual(['s2'])
  expect(mocks.assign.mock.calls[1][0].request_key).toBe(payload.request_key)
})
it('недоступный набор не позволяет выдать план', async () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AssignmentDialog activity={activity} intakes={[{ ...intakes[0], deadline: '2001-01-01' }]} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Алина' }))
  expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  expect(mocks.assign).not.toHaveBeenCalled()
})

it('типовые шаги подставляются с датами от дедлайна набора', async () => {
  mocks.template.mockResolvedValue([
    { title: 'Регистрация', description: '', expected_result: '', priority: 'required', requires_review: false, requires_evidence: true, days_before_deadline: 30, subtasks: [] },
    { title: 'Эссе', description: '', expected_result: '', priority: 'required', requires_review: true, requires_evidence: false, days_before_deadline: null, subtasks: ['Черновик'] },
  ])
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AssignmentDialog activity={activity} intakes={[{ ...intakes[0], mode: 'fixed', deadline: '2099-12-31' }]} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Алина' }))
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  expect(await screen.findByText(/Шаги подставлены из типового плана/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: 'Назначить · 1' }))
  await waitFor(() => expect(mocks.assign).toHaveBeenCalled())
  expect(mocks.assign.mock.calls[0][0].recipients[0].steps).toMatchObject([
    { title: 'Регистрация', due_date: '2099-12-01', requires_evidence: true },
    { title: 'Эссе', due_date: null, requires_review: true, subtasks: ['Черновик'] },
  ])
})
