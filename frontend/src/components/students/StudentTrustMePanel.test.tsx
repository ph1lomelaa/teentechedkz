import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trustmeApi } from '@/api/trustme'
import { StudentTrustMePanel } from './StudentTrustMePanel'

vi.mock('@/api/trustme', () => ({ trustmeApi: { list: vi.fn(), search: vi.fn(), link: vi.fn(), unlink: vi.fn(), pdf: vi.fn() } }))

const candidate = { external_id: 'doc', short_url: '4Kuowd19', name: 'Договор Нұрай', number: '474',
  status: 3, created_at: '2026-07-28', signers: [{ name: 'Родитель', signed: true, is_company: false }] }

function show(canManage = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <StudentTrustMePanel studentId="student" studentName="Жолдас Нурай" canManage={canManage} />
  </QueryClientProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(trustmeApi.list).mockResolvedValue([])
  vi.mocked(trustmeApi.search).mockResolvedValue({ candidates: [candidate], queries: ['Жолдас'], truncated: false })
  vi.mocked(trustmeApi.link).mockResolvedValue({ ...candidate, id: 'link', linked_at: '2026-11-01' })
})

describe('TrustMe selection', () => {
  it('requires explicit identity confirmation before linking', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Найти в TrustMe' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать договор' }))
    const confirm = screen.getByRole('button', { name: 'Подтвердить привязку' })
    expect(confirm).toBeDisabled()
    expect(trustmeApi.link).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirm)
    await waitFor(() => expect(trustmeApi.link).toHaveBeenCalledWith('student', '4Kuowd19'))
  })

  it('shows revoked candidates without allowing selection', async () => {
    vi.mocked(trustmeApi.search).mockResolvedValue({ candidates: [{ ...candidate, status: 4 }], queries: [], truncated: false })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Найти в TrustMe' }))
    expect(await screen.findByRole('button', { name: 'Выбрать договор' })).toBeDisabled()
    expect(screen.getByText(/Отозван компанией/)).toBeInTheDocument()
  })

  it('presents manual Cloudflare verification and does not retry', async () => {
    vi.mocked(trustmeApi.search).mockRejectedValue({ response: { data: { detail: 'Требуется проверка' },
      headers: { 'x-error-code': 'TRUSTME_CHALLENGE_REQUIRED' } } })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Найти в TrustMe' }))
    expect(await screen.findByRole('link', { name: 'Открыть кабинет TrustMe' })).toHaveAttribute('href', 'https://trustme.kz/app/sign-in')
    expect(trustmeApi.search).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('может не восстановить доступ сервера')
  })

  it('does not offer corporate search to viewers', async () => {
    show(false)
    await screen.findByText('Договоры TrustMe ещё не привязаны.')
    expect(screen.queryByRole('button', { name: 'Найти в TrustMe' })).not.toBeInTheDocument()
  })
})
