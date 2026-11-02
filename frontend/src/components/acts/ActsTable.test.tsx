// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { actsApi, type ActsTable as Table } from '@/api/acts'
import { downloadBlob } from '@/lib/utils'
import { ActsTable } from './ActsTable'

const auth = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', role: auth.role }, can: () => true }) }))
vi.mock('@/lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/utils')>(), downloadBlob: vi.fn() }))
vi.mock('@/api/acts', async importOriginal => ({ ...await importOriginal<typeof import('@/api/acts')>(), actsApi: { table: vi.fn(), pdf: vi.fn(), contractPdf: vi.fn() } }))
vi.mock('@/components/students/StudentActsPanel', () => ({ StudentActsPanel: () => <div>Панель актов</div> }))

const base = { phone: null, status: 'active_work', intake: 2026, degree: null, mzk: null, responsibles: [] }
const DATA: Table = {
  columns: [{ key: 'profile', label: 'Оценка профиля' }, { key: 'career', label: 'Профориентация' }, { key: 'essays', label: 'Эссе' }],
  rows: [
    { ...base, student_id: 's1', full_name: 'Жолдас Нұрай', mine: true, services_total: 2, services_closed: 1, percent: 50,
      contracts: [{ id: 'c1', number: '474', name: 'Admission', status: 3, financial_contract_id: null }],
      cells: { profile: { state: 'sent', act_id: 'a1', date: '2026-11-12', file_name: 'Акт.pdf' }, career: { state: 'missing' }, essays: { state: 'none' } } },
    { ...base, student_id: 's2', full_name: 'Атанчаева Перизат', mine: false, services_total: 1, services_closed: 1, percent: 100,
      contracts: [{ id: 'c2', number: '456', name: 'Admission', status: 3, financial_contract_id: null }],
      cells: { profile: { state: 'ready', act_id: 'a2', date: '2026-11-10', file_name: 'Акт2.pdf' }, career: { state: 'none' }, essays: { state: 'none' } } },
  ],
}
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <ActsTable selected={null} onSelect={vi.fn()} /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.resetAllMocks(); auth.role = 'admin'; localStorage.clear(); vi.mocked(actsApi.table).mockResolvedValue(structuredClone(DATA)) })
afterEach(cleanup)

it('shows the three act states per service and downloads an act on click', async () => {
  vi.mocked(actsApi.pdf).mockResolvedValue(new Blob(['pdf']))
  mount()
  const sent = await screen.findByRole('button', { name: 'Отправлен 12.11' })
  expect(screen.getByRole('button', { name: 'Создан 10.11, не отправлен' })).toBeInTheDocument()
  expect(screen.getByText('Не создан')).toBeInTheDocument()
  expect(screen.getByText('1/2')).toBeInTheDocument()
  fireEvent.click(sent)
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Акт.pdf'))
  expect(actsApi.pdf).toHaveBeenCalledWith('a1')
})

it('filters to own students and searches by contract number', async () => {
  mount()
  await screen.findByText('Атанчаева Перизат')
  fireEvent.click(screen.getByRole('button', { name: 'Мои' }))
  expect(screen.queryByText('Атанчаева Перизат')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Все' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '456' } })
  await waitFor(() => expect(screen.queryByText('Жолдас Нұрай')).not.toBeInTheDocument())
  expect(screen.getByText('Атанчаева Перизат')).toBeInTheDocument()
})

it('quick filter keeps students with an unsent act', async () => {
  mount()
  await screen.findByText('Жолдас Нұрай')
  fireEvent.click(screen.getByRole('button', { name: 'Акт не отправлен' }))
  expect(screen.queryByText('Жолдас Нұрай')).not.toBeInTheDocument()
  expect(screen.getByText('Атанчаева Перизат')).toBeInTheDocument()
})

it('mentor sees no all/mine switch because the server already returns only own students', async () => {
  auth.role = 'mentor'
  mount()
  await screen.findByText('Жолдас Нұрай')
  expect(screen.queryByRole('button', { name: 'Мои' })).not.toBeInTheDocument()
})
