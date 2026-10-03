import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NoteDetailPage } from './NoteDetailPage'

const mocks = vi.hoisted(() => ({ get: vi.fn(), review: vi.fn(), publish: vi.fn(), can: vi.fn() }))
vi.mock('@/api/notes', () => ({ notesApi: { ...mocks, diff: async () => ({ preview: [] }) } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: mocks.can }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const draft = { id: 'n1', student_id: 's1', student_name: 'Студент', title: 'Встреча', status: 'draft', created_at: '2026-10-02', summary_markdown: 'Итог для команды', student_summary_markdown: 'Итог для ученика', source_text: 'Исходная речь', suggested_changes: {}, published_to_student: false }
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/notes/n1']}><Routes><Route path="/notes/:id" element={<NoteDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks(); mocks.can.mockReturnValue(true); mocks.get.mockResolvedValue(draft)
  mocks.review.mockImplementation(async (_id, payload) => { const updated = { ...draft, ...payload, status: 'approved' }; mocks.get.mockResolvedValue(updated); return updated })
  mocks.publish.mockResolvedValue({ ...draft, status: 'approved', published_to_student: true })
})
it('переключает версии и расшифровку без открытия редактора', async () => {
  open(); await screen.findByText('Итог для команды')
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Для ученика' }))
  expect(screen.getByText('Итог для ученика')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Расшифровка' }))
  expect(screen.getByText('Исходная речь')).toBeTruthy()
})
it('сохраняет правки при одобрении, публикует только отдельным действием', async () => {
  open(); await screen.findByText('Итог для команды')
  fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Итог встречи' }), { target: { value: 'Исправленный итог' } })
  fireEvent.click(screen.getByRole('button', { name: 'Одобрить конспект' }))
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('n1', expect.objectContaining({ action: 'approve', summary_markdown: 'Исправленный итог' })))
  expect(mocks.publish).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Отправить ученику' }))
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith('n1', { student_title: null, hidden_blocks: [] }))
})
it('без права управления скрывает редактирование и одобрение', async () => {
  mocks.can.mockReturnValue(false); open(); await screen.findByText('Итог для команды')
  expect(screen.queryByRole('button', { name: 'Редактировать' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Одобрить конспект' })).toBeNull()
})
