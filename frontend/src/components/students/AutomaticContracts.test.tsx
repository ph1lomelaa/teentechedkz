import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { trustmeApi } from '@/api/trustme'
import { AutomaticContracts } from './AutomaticContracts'
vi.mock('@/api/trustme', () => ({ trustmeApi: { autoLink: vi.fn(), link: vi.fn(), inspect: vi.fn(), pdf: vi.fn() } }))
const changed = vi.fn()
function show() { render(<QueryClientProvider client={new QueryClient()}><AutomaticContracts studentId="student" onChanged={changed} /></QueryClientProvider>) }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(trustmeApi.autoLink).mockResolvedValue({ state: 'complete', linked_ids: ['link'], review: [] }) })
it('finds and links contracts automatically without any employee interaction', async () => {
  show()
  expect(await screen.findByText('Договоры привязаны автоматически · 1')).toBeInTheDocument()
  expect(trustmeApi.autoLink).toHaveBeenCalledWith('student')
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Привязать/ })).not.toBeInTheDocument()
})
it('asks for one confirmation only for an ambiguous contract', async () => {
  vi.mocked(trustmeApi.autoLink).mockResolvedValue({ state: 'complete', linked_ids: [], review: [{ short_url: 'review123', name: 'Договор родителя', status: 3, number: '123', created_at: null, signers: [], reason: 'В PDF не указан студент' }] })
  vi.mocked(trustmeApi.link).mockResolvedValue({ id: 'link', short_url: 'review123', name: 'Договор родителя', status: 3, number: '123', created_at: null, signers: [], linked_at: '2026-11-02' })
  show()
  const button = await screen.findByRole('button', { name: 'Подтвердить и привязать' })
  expect(trustmeApi.link).not.toHaveBeenCalled()
  fireEvent.click(button)
  await waitFor(() => expect(trustmeApi.link).toHaveBeenCalledWith('student', 'review123'))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Подтвердить и привязать' })).not.toBeInTheDocument())
})
it('shows provider failure without losing already linked contracts', async () => {
  vi.mocked(trustmeApi.autoLink).mockResolvedValue({ state: 'unavailable', linked_ids: [], review: [] })
  show()
  expect(await screen.findByText(/Автопоиск временно недоступен/)).toBeInTheDocument()
})
