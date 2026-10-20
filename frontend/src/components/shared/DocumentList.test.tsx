import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentList } from './DocumentList'
const api = vi.hoisted(() => ({ rename: vi.fn(), verify: vi.fn(), setType: vi.fn() }))
vi.mock('@/api/documents', () => ({ documentsApi: api }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const document = { id: 'd1', student_id: 's1', file_name: 'Транскрипт.pdf', doc_type: 'transcript', file_size: 100, mime_type: 'application/pdf', source: 'manual_upload', is_verified: false, visible_to_student: false, uploaded_at: '2026-10-20T00:00:00Z' }
const actions = { onOpen: vi.fn(), onDownload: vi.fn(), onChanged: vi.fn(), onDelete: vi.fn() }
function open(props: Partial<React.ComponentProps<typeof DocumentList>> = {}) {
 render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><MemoryRouter><DocumentList tone="p" documents={[document]} {...actions} {...props} /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.clearAllMocks(); api.rename.mockResolvedValue({}); api.verify.mockResolvedValue({}) })
afterEach(cleanup)
describe.each(['p', 'w'] as const)('общий список: оболочка %s', (tone) => {
 it('режим просмотра не предлагает управление; открывает и скачивает выбранный документ', () => {
  open({ tone }); fireEvent.click(screen.getByRole('button', { name: 'Открыть Транскрипт.pdf' })); expect(actions.onOpen).toHaveBeenCalledWith(document)
  expect(screen.queryByRole('button', { name: 'Отметить проверенным' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Действия с Транскрипт.pdf' })); fireEvent.click(screen.getByRole('button', { name: 'Скачать' })); expect(actions.onDownload).toHaveBeenCalledWith(document)
 })
 it('проверка документа и переименование используют общие API', async () => {
  open({ tone, canManage: true }); fireEvent.click(screen.getByRole('button', { name: 'Отметить проверенным' })); await waitFor(() => expect(api.verify).toHaveBeenCalledWith('d1', true)); await waitFor(() => expect(actions.onChanged).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Переименовать' })); fireEvent.change(screen.getByRole('textbox', { name: 'Новое название' }), { target: { value: 'Новый транскрипт' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить название' })); await waitFor(() => expect(api.rename).toHaveBeenCalledWith('d1', 'Новый транскрипт'))
 })
})
it('встроенный список не дублирует фильтры и справку, но сохраняет проверку документа', () => {
 open({ embedded: true, canManage: true }); expect(screen.queryByLabelText('Проверка документов')).toBeNull(); expect(screen.queryByText('Проверка, видимость и подтверждение — что это?')).toBeNull(); expect(screen.getByRole('button', { name: 'Отметить проверенным' })).toBeTruthy()
})
it('показывает внутренний источник и ссылку в нужный чат', () => {
 open({ tone: 'w', sourceChatPath: '/workspace/chat', documents: [{ ...document, source_message: { channel: 'internal', message_id: 'm1', chat_id: 'c1' } }] }); expect(screen.getByText(/Внутренний чат/)).toBeTruthy(); expect(screen.getByRole('link', { name: 'Исходное сообщение' })).toHaveAttribute('href', '/workspace/chat?channel=all&student_id=s1&message_id=m1')
})
