import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ submissions: vi.fn(), snapshots: vi.fn(), link: vi.fn(), getAll: vi.fn() }))
vi.mock('@/api/students', () => ({ studentsApi: {
  list: async () => ({ items: [], total: 0 }), getAll: mocks.getAll,
  facets: async () => ({ statuses: [], years: [], degrees: [], countries: [] }),
} }))
vi.mock('@/api/index', () => ({ usersApi: { list: async () => [] }, mentorAssignmentsApi: {} }))
vi.mock('@/api/sync', () => ({ syncApi: {
  status: async () => ({ new_submissions: 1 }), overview: async () => ({}), submissions: mocks.submissions, link: mocks.link,
} }))
vi.mock('@/api/notion', () => ({ notionApi: {
  status: async () => ({}), pipelineReport: async () => ({ rows: [] }),
  pipelineTable: async () => ({ items: [] }), snapshots: mocks.snapshots,
} }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { id: 'admin' } }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const { StudentsListPage } = await import('./StudentsListPage')
function Address() { const loc = useLocation(); return <output data-testid="address">{loc.search}</output> }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/students?inbox=1&notion=1&origin=base']}><Address /><StudentsListPage /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.submissions.mockResolvedValue({ items: [{ id: 'f1', source: 'package', full_name: 'Новая Анкета', status: 'new', identity_review_required: true }], total: 1 })
  mocks.snapshots.mockResolvedValue({ items: [
    { id: 'n1', full_name: 'Похожее Имя', status: 'new', suggested_student_id: 's1', suggested_confidence: .95, bulk_link_eligible: false, link_block_reason: 'Неточное совпадение. Проверьте кандидата.' },
  ], total: 1 })
  mocks.getAll.mockResolvedValue([{ id: 's1', full_name: 'Тестовый Студент', intake_year: 2026 }])
  mocks.link.mockResolvedValue({})
})
it('closes each inbox separately and preserves unrelated URL filters', async () => {
  mount()
  expect(await screen.findByText('Новая Анкета')).toBeVisible()
  expect(await screen.findByText('Похожее Имя')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть: Входящие анкеты' }))
  expect(screen.queryByText('Новая Анкета')).not.toBeInTheDocument()
  expect(screen.getByText('Похожее Имя')).toBeVisible()
  expect(screen.getByTestId('address')).toHaveTextContent('notion=1')
  expect(screen.getByTestId('address')).not.toHaveTextContent('inbox=1')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть: Notion без привязки' }))
  expect(screen.queryByText('Похожее Имя')).not.toBeInTheDocument()
  expect(screen.getByTestId('address')).toHaveTextContent('?origin=base')
})
it('does not count a 95% suggestion as a safe bulk link', async () => {
  mount()
  const row = (await screen.findByText('Похожее Имя')).closest('table')!.parentElement!.parentElement!
  expect(screen.getByText('Неточное совпадение. Проверьте кандидата.')).toBeVisible()
  expect(within(row).getByRole('button', { name: 'Привязать все' })).toBeDisabled()
  expect(within(row).getByRole('button', { name: 'Привязать' })).toBeEnabled()
})
it('shows an intake loading failure instead of claiming everything was processed', async () => {
  mocks.submissions.mockRejectedValue({ response: { data: { detail: 'Сервис временно недоступен' } } })
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('Сервис временно недоступен')
  expect(screen.queryByText('Все анкеты обработаны')).not.toBeInTheDocument()
  mocks.submissions.mockResolvedValue({ items: [], total: 0 })
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByText('Все анкеты обработаны')).toBeVisible()
})
it('lets a manager manually link a reviewed form and keeps a failed attempt visible for retry', async () => {
  mocks.link.mockRejectedValueOnce({ response: { data: { detail: 'Проверьте выбранного студента' } } }).mockResolvedValueOnce({})
  mount()
  fireEvent.click(within((await screen.findByText('Новая Анкета')).closest('tr')!).getByRole('button', { name: 'Привязать' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Тестовый Студент 2026' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Привязать' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Проверьте выбранного студента')
  expect(mocks.link).toHaveBeenCalledWith('f1', 's1')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Привязать' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(mocks.link).toHaveBeenCalledTimes(2)
})
