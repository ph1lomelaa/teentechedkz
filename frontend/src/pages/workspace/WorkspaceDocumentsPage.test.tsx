import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceDocumentsPage } from './WorkspaceDocumentsPage'
const mocks = vi.hoisted(() => ({ documents: vi.fn(), students: vi.fn(), upload: vi.fn(), verify: vi.fn(), can: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'mentor', role: 'mentor' }, can: mocks.can }) }))
vi.mock('@/api/workspace', () => ({ workspaceApi: { documents: mocks.documents, students: mocks.students } }))
vi.mock('@/api/documents', () => ({ documentsApi: { upload: mocks.upload, verify: mocks.verify } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const doc = (id: string, student: string, verified = false) => ({ id, student_id: student, student_name: student === 's1' ? 'Анна' : 'Борис', file_name: `${id}.pdf`, doc_type: 'other', mime_type: 'application/pdf', file_size: 123, source: 'manual_upload', uploaded_at: '2026-10-19T10:00:00Z', is_verified: verified, visible_to_student: false })
function open() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter><WorkspaceDocumentsPage /></MemoryRouter></QueryClientProvider>) }
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.can.mockReturnValue(true); mocks.documents.mockResolvedValue({ items: [doc('new', 's1'), doc('checked', 's2', true)] }); mocks.students.mockResolvedValue({ items: [{ student: { id: 's1', full_name: 'Анна' } }, { student: { id: 's2', full_name: 'Борис' } }] }); mocks.upload.mockResolvedValue({}) })
afterEach(cleanup)
it('по умолчанию показывает непроверенные; вкладки и поиск согласованы со счётчиками', async () => {
 open(); await screen.findByText('new'); expect(screen.queryByText('checked')).toBeNull()
 fireEvent.click(screen.getByRole('tab', { name: 'Все · 2' })); expect(screen.getByText('checked')).toBeTruthy()
 fireEvent.change(screen.getByPlaceholderText('Документ или студент'), { target: { value: 'Борис' } })
 expect(screen.getByRole('tab', { name: 'Нужна проверка · 0' })).toBeTruthy(); expect(screen.queryByText('new')).toBeNull()
 fireEvent.click(screen.getByRole('tab', { name: 'Проверены · 1' })); expect(screen.getByText('checked')).toBeTruthy()
})
it('всегда показывает список, даже если раньше были выбраны плитки; группы сворачиваются', async () => {
 localStorage.setItem('workspace:documents:view', JSON.stringify('tiles'))
 open(); await screen.findByText('new'); expect(screen.queryByRole('tab', { name: 'Плитки' })).toBeNull(); expect(screen.queryByRole('tab', { name: 'Список' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Свернуть: Анна' })); expect(screen.queryByText('new')).toBeNull()
 expect(screen.getByRole('link', { name: 'Карточка →' })).toHaveAttribute('href', '/workspace/students/s1#documents')
 fireEvent.click(screen.getByRole('button', { name: 'Развернуть: Анна' })); expect(screen.getByText('new')).toBeTruthy()
})
it('роль без documents:manage видит список без действий управления', async () => {
 mocks.can.mockReturnValue(false); open(); await screen.findByText('new')
 expect(screen.queryByRole('button', { name: 'Загрузить документ' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Отметить проверенным' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Запросить подтверждение' })).toBeNull()
 expect(screen.getByRole('button', { name: 'Открыть new.pdf' })).toBeTruthy()
})
it('ссылка на исходное сообщение сохраняется в списке', async () => {
 mocks.documents.mockResolvedValue({items:[{...doc('telegram','s1'), source:'telegram', source_message:{channel:'telegram', message_id:'message1', chat_id:'chat1'}}]})
 open(); expect(await screen.findByRole('link', {name:'Исходное сообщение'})).toHaveAttribute('href','/workspace/chat?channel=all&student_id=s1&message_id=message1')
})
it('форма скрыта; загрузка требует студента и файл и вызывает API', async () => {
 open(); expect(screen.queryByLabelText('Выберите документ для загрузки')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Загрузить документ' })); await screen.findAllByRole('option', { name: 'Анна' })
 expect(screen.getByRole('button', { name: 'Загрузить' })).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Студент для загрузки'), { target: { value: 's1' } })
 const file = new File(['pdf'], 'test.pdf', { type: 'application/pdf' }); fireEvent.change(screen.getByLabelText('Выберите документ для загрузки'), { target: { files: [file] } })
 fireEvent.click(screen.getByRole('button', { name: 'Загрузить' })); await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith('s1', file, 'other'))
})
it('ошибка API не превращается в пустой список', async () => { mocks.documents.mockRejectedValue(new Error('Нет связи')); open(); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByText('Документов нет')).toBeNull() })
