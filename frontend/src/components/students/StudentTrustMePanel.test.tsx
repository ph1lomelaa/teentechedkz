import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trustmeApi } from '@/api/trustme'
import { guardiansApi } from '@/api'
import { StudentTrustMePanel } from './StudentTrustMePanel'

vi.mock('@/api', () => ({ guardiansApi: { listByStudent: vi.fn() } }))

vi.mock('@/api/trustme', () => ({ trustmeApi: { list: vi.fn(), search: vi.fn(), link: vi.fn(), unlink: vi.fn(), pdf: vi.fn() } }))

const candidate = { external_id: 'doc', short_url: '4Kuowd19', name: 'Договор Жолдас Нұрай', number: '474',
  status: 3, created_at: '2026-07-28', signers: [{ name: 'Родитель', signed: true, is_company: false }] }

function show(canManage = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <StudentTrustMePanel studentId="student" studentName="Жолдас Нурай" canManage={canManage} />
  </QueryClientProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(guardiansApi.listByStudent).mockResolvedValue([])
  vi.mocked(trustmeApi.list).mockResolvedValue([])
  vi.mocked(trustmeApi.search).mockResolvedValue({ candidates: [candidate], queries: ['Жолдас'], truncated: false })
  vi.mocked(trustmeApi.link).mockResolvedValue({ ...candidate, id: 'link', linked_at: '2026-11-01' })
})

describe('TrustMe selection', () => {
  it('requires explicit identity confirmation before linking', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать' }))
    const confirm = screen.getByRole('button', { name: 'Привязать договор' })
    expect(confirm).toBeDisabled()
    expect(trustmeApi.link).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Проверено по PDF/ }))
    fireEvent.click(confirm)
    await waitFor(() => expect(trustmeApi.link).toHaveBeenCalledWith('student', '4Kuowd19'))
  })

  it('shows revoked candidates without allowing selection', async () => {
    vi.mocked(trustmeApi.search).mockResolvedValue({ candidates: [{ ...candidate, status: 4 }], queries: [], truncated: false })
    show()
    await waitFor(() => expect(trustmeApi.search).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Отозван компанией')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Показать неподписанные и отозванные' }))
    expect(await screen.findByRole('button', { name: 'Выбрать' })).toBeDisabled()
    expect(screen.getByText(/Отозван компанией/)).toBeInTheDocument()
  })

  it('presents manual Cloudflare verification and does not retry', async () => {
    vi.mocked(trustmeApi.search).mockRejectedValue({ response: { data: { detail: 'Требуется проверка' },
      headers: { 'x-error-code': 'TRUSTME_CHALLENGE_REQUIRED' } } })
    show()
    expect(await screen.findByRole('link', { name: 'Открыть TrustMe' })).toHaveAttribute('href', 'https://trustme.kz/app/sign-in')
    expect(trustmeApi.search).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Требуется проверка')
  })

  it('does not offer corporate search to viewers', async () => {
    show(false)
    await waitFor(() => expect(trustmeApi.list).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Найти' })).not.toBeInTheDocument()
    expect(trustmeApi.search).not.toHaveBeenCalled()
  })
})
