import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { documentsApi } from '@/api/documents'
import type { Document } from '@/types'
import { DocumentReviewControls } from './DocumentReviewControls'
import { DocumentList } from './DocumentList'
import { invalidateDocuments } from '@/lib/queryKeys'

vi.mock('@/api/documents', () => ({ documentsApi: { verify: vi.fn(), requestSignature: vi.fn(), revokeSignature: vi.fn(), delete: vi.fn() } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const doc: Document = { id: 'd1', student_id: 's1', file_name: 'demo.pdf', doc_type: 'other', file_size: 10, mime_type: 'application/pdf', source: 'manual_upload', uploaded_at: '2026-10-19', is_verified: false, visible_to_student: false, signature_status: 'none' }
function setup(value = doc) {
  const onChanged = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><DocumentReviewControls doc={value} onChanged={onChanged} allowDelete /></QueryClientProvider>)
  return onChanged
}
beforeEach(() => vi.resetAllMocks())
it('marks reviewed explicitly and allows returning to review', async () => {
  const changed = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Отметить проверенным' }))
  await waitFor(() => expect(documentsApi.verify).toHaveBeenCalledWith('d1', true))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
})
it('returns a checked document to review', async () => {
  setup({ ...doc, is_verified: true })
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть на проверку' }))
  await waitFor(() => expect(documentsApi.verify).toHaveBeenCalledWith('d1', false))
})
it('explains acknowledgment before sending and keeps review independent', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Запросить подтверждение' }))
  expect(screen.getByText(/Документ станет виден студенту/)).toBeVisible()
  expect(documentsApi.requestSignature).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
  await waitFor(() => expect(documentsApi.requestSignature).toHaveBeenCalledWith('d1'))
  expect(documentsApi.verify).not.toHaveBeenCalled()
})
it('preserves confirmed evidence and offers no repeat request', () => {
  setup({ ...doc, signature_status: 'signed', signature_full_name: 'Demo Student' })
  expect(screen.getByText(/Подтверждено студентом · Demo Student/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Запросить подтверждение' })).not.toBeInTheDocument()
})
it('keeps failed review actionable with an error', async () => {
  vi.mocked(documentsApi.verify).mockRejectedValueOnce(new Error('Ошибка сети'))
  const changed = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Отметить проверенным' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Ошибка сети')
  expect(changed).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Отметить проверенным' })).toBeEnabled()
})
it('requires confirmation before deleting', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
  expect(documentsApi.delete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Удалить документ' }))
  await waitFor(() => expect(documentsApi.delete).toHaveBeenCalledWith('d1'))
})
it('opening or sharing a file does not mark it reviewed; filter isolates review status', () => {
  const onOpen = vi.fn(), onVisibility = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><DocumentList documents={[doc, { ...doc, id: 'd2', file_name: 'checked.pdf', is_verified: true }]} tone="p" canManage onOpen={onOpen} onVisibility={onVisibility} onDownload={vi.fn()} onDelete={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Открыть demo.pdf' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Показать студенту' })[0])
  expect(onOpen).toHaveBeenCalledWith(doc)
  expect(onVisibility).toHaveBeenCalledWith(doc)
  expect(documentsApi.verify).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox', { name: 'Проверка документов' }), { target: { value: 'unverified' } })
  expect(screen.queryByRole('button', { name: 'Открыть checked.pdf' })).not.toBeInTheDocument()
})
it('does not expose staff controls in the student portal', () => {
  render(<QueryClientProvider client={new QueryClient()}><DocumentList documents={[doc]} tone="p" onOpen={vi.fn()} onDownload={vi.fn()} onDelete={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>)
  expect(screen.queryByRole('button', { name: 'Отметить проверенным' })).not.toBeInTheDocument()
  expect(screen.queryByText('Нужна проверка')).not.toBeInTheDocument()
})
it('refreshes persisted counts and card after a review decision', () => {
  const client = new QueryClient()
  const keys = [['student', 's1'], ['student-timeline', 's1'], ['workspace', 'dashboard'], ['workspace', 'documents'], ['students', 'all'], ['portal', 'documents']]
  keys.forEach(key => client.setQueryData(key, { count: 1 }))
  invalidateDocuments(client, 's1')
  keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true))
})
