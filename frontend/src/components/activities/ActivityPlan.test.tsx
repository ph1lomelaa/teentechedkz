import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActivityPlan } from './ActivityPlan'

const mocks = vi.hoisted(() => ({ plan: vi.fn(), summary: vi.fn(), participation: vi.fn(), tasks: vi.fn(), mentors: vi.fn(), submissions: vi.fn(), editPlan: vi.fn(), create: vi.fn() }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
vi.mock('@/api/learnerTasks', async (orig) => ({ ...(await orig<typeof import('@/api/learnerTasks')>()), learnerTasksApi: { create: mocks.create } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'm1', role: 'mentor' }, can: () => true }) }))
vi.mock('@/lib/ws', () => ({ useWsEvent: () => undefined }))
vi.mock('./PortfolioSummaryCard', () => ({ PortfolioSummaryCard: () => null }))

const intake = { id: 'i1', label: 'Осень 2026', deadline: '2026-11-20', mode: 'deadline' }
const item = { id: 'p1', student_id: 's1', student_name: 'Алина', intake_id: 'i1', intake, decision: 'selected', status: 'in_progress', selection_source: 'staff',
  activity: { id: 'a1', title: 'Олимпиада по математике', experience_type: 'competitions' }, steps: { total: 0, done: 0, pending: 0, returned: 0, overdue: 0, next: null } }

function open(path = '/workspace/students/s1#portfolio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<ActivityPlan studentId="s1" catalogPath="" />} /></Routes></MemoryRouter></QueryClientProvider>)
}
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  mocks.plan.mockResolvedValue([item]); mocks.summary.mockResolvedValue({ mentor_actions: [], student_actions: [] })
  mocks.participation.mockResolvedValue(item); mocks.tasks.mockResolvedValue([]); mocks.mentors.mockResolvedValue([]); mocks.submissions.mockResolvedValue({})
  mocks.create.mockResolvedValue({ id: 't1' })
})

it('активность раскрывается в карточке ученика, шаг добавляется прямо в плане', async () => {
  open()
  expect(await screen.findByRole('link', { name: 'Добавить активность' })).toHaveAttribute('href', '/workspace/activities/pick?student=s1')
  fireEvent.click(screen.getByRole('button', { name: /Олимпиада по математике/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить шаг' }))
  fireEvent.change(screen.getByLabelText('Что сделать'), { target: { value: 'Зарегистрироваться' } })
  fireEvent.change(screen.getByLabelText('Срок'), { target: { value: '2026-11-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Зарегистрироваться', due_date: '2026-11-01', requires_review: true, student_id: 's1', activity_participation_id: 'p1' })))
})

it('ссылка с ?p= открывает нужную активность сразу', async () => {
  open('/workspace/students/s1?p=p1#portfolio')
  expect(await screen.findByRole('button', { name: 'Добавить шаг' })).toBeTruthy()
  expect(mocks.participation).toHaveBeenCalledWith('p1')
})
