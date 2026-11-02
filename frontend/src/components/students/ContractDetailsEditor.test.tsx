import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { trustmeApi } from '@/api/trustme'
import { ContractDetailsEditor } from './ContractDetailsEditor'
vi.mock('@/api/trustme', () => ({ trustmeApi: { inspect: vi.fn(), details: vi.fn() } }))
const contract = { id: 'manual', short_url: 'manual123', name: 'Договор', number: null, status: 3, signers: [], source: 'manual' as const, created_at: '2026-11-02' }
function show() { render(<QueryClientProvider client={new QueryClient()}><ContractDetailsEditor studentId="student" contract={contract} onSaved={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>) }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(trustmeApi.inspect).mockResolvedValue({ status: 3, fields: { contract_date: '2026-07-28', customer_name: 'Другой Подписант' }, sources: {}, conflicts: {}, missing: [], service_hints: {}, pages: [], signers: [], suggested_contract_number: null })
  vi.mocked(trustmeApi.details).mockResolvedValue({ ...contract, linked_at: '2026-11-02' })
})
it('keeps header and signing dates separate and does not use created date', async () => {
  show()
  await waitFor(() => expect(screen.getByLabelText(/Дата договора/)).toHaveValue('2026-07-28'))
  expect(screen.getByLabelText(/Дата подписания/)).toHaveValue('')
  fireEvent.change(screen.getByLabelText(/Дата подписания/), { target: { value: '2026-08-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить реквизиты' }))
  await waitFor(() => expect(trustmeApi.details).toHaveBeenCalledWith('student', 'manual', expect.objectContaining({ contract_date: '2026-07-28', signed_date: '2026-08-01', customer_name: 'Другой Подписант' })))
})
it('keeps manually edited fields when extraction finishes later', async () => {
  let finish!: (value: Awaited<ReturnType<typeof trustmeApi.inspect>>) => void
  vi.mocked(trustmeApi.inspect).mockReturnValue(new Promise(resolve => { finish = resolve }))
  show()
  fireEvent.change(screen.getByLabelText(/Подписант/), { target: { value: 'Проверенный Подписант' } })
  finish({ status: 3, fields: { customer_name: 'Найденный Подписант' }, sources: {}, conflicts: {}, missing: [], service_hints: {}, pages: [], signers: [], suggested_contract_number: null })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить реквизиты' })).not.toBeDisabled())
  expect(screen.getByLabelText(/Подписант/)).toHaveValue('Проверенный Подписант')
})
