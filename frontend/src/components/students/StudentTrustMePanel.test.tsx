import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { trustmeApi } from '@/api/trustme'
import { StudentTrustMePanel } from './StudentTrustMePanel'
vi.mock('@/api/trustme', () => ({ trustmeApi: { search: vi.fn(), link: vi.fn(), pdf: vi.fn(), upload: vi.fn(), inspect: vi.fn(), details: vi.fn() } }))
const candidate = { external_id: 'doc', short_url: '4Kuowd19', name: 'Договор родителя', number: '474', status: 3, created_at: '2026-07-28', signers: [{ name: 'Другой Подписант', signed: true, is_company: false }] }
function show(canManage = true) { render(<QueryClientProvider client={new QueryClient()}><StudentTrustMePanel studentId="student" studentName="Жолдас Нурай" canManage={canManage} /></QueryClientProvider>) }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(trustmeApi.search).mockResolvedValue({ candidates: [candidate], queries: [], truncated: false })
  vi.mocked(trustmeApi.link).mockResolvedValue({ ...candidate, id: 'link', linked_at: '2026-11-01' })
  vi.mocked(trustmeApi.inspect).mockResolvedValue({ status: 3, fields: {}, sources: {}, conflicts: {}, missing: [], service_hints: {}, pages: [], signers: [], suggested_contract_number: null })
})
it('keeps only upload and an optional unified lookup in the exception path', () => {
  show()
  expect(screen.getByLabelText('Файл договора')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(trustmeApi.search).not.toHaveBeenCalled()
})
it('accepts a number or reference in one field without choosing a search type', async () => {
  show()
  fireEvent.click(screen.getByText('Найти другой договор в TrustMe'))
  fireEvent.change(screen.getByLabelText('Любые данные договора'), { target: { value: '671' } })
  fireEvent.click(screen.getByRole('button', { name: /^Найти$/ }))
  await waitFor(() => expect(trustmeApi.search).toHaveBeenCalledWith('student', '671', [], 'auto'))
  expect(await screen.findByText('Другой Подписант', { exact: false })).toBeInTheDocument()
  expect(trustmeApi.link).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и привязать' }))
  await waitFor(() => expect(trustmeApi.link).toHaveBeenCalledWith('student', '4Kuowd19'))
})
it('requires confirmation for manual upload, independently of TrustMe', async () => {
  show()
  const file = new File(['%PDF-test'], 'Договор.pdf', { type: 'application/pdf' })
  fireEvent.change(screen.getByLabelText('Файл договора'), { target: { files: [file] } })
  expect(screen.getByRole('button', { name: 'Загрузить договор' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /Договор относится к студенту/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить договор' }))
  await waitFor(() => expect(trustmeApi.upload).toHaveBeenCalledWith('student', file, 'Договор', false))
})
it('does not offer manual mutations to a viewer', () => {
  show(false)
  expect(screen.queryByLabelText('Файл договора')).not.toBeInTheDocument()
  expect(trustmeApi.search).not.toHaveBeenCalled()
})
