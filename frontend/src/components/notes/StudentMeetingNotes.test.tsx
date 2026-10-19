import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { StudentMeetingNotes } from './StudentMeetingNotes'
vi.mock('@/api/notes', () => ({ notesApi: { list: async () => [{ id: 'n1', title: 'Итоги встречи', created_at: '2026-10-19T08:00:00Z', summary_markdown: 'План поступления', status: 'draft' }] } }))
it.each([false, true])('keeps working create and open links in the student notes tab (workspace=%s)', async workspace => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><StudentMeetingNotes studentId="s1" workspace={workspace} /></MemoryRouter></QueryClientProvider>)
  const create = screen.getByRole('link', { name: 'Записать встречу' })
  expect(create).toHaveAttribute('href', `${workspace ? '/workspace/notes' : '/notes'}?student_id=s1&create=1`)
  expect(await screen.findByText('Итоги встречи')).toBeVisible()
  expect(screen.getByText('План поступления', { selector: 'p.line-clamp-2' })).toBeVisible()
  expect(screen.getByText('Проверить конспект').closest('a')).toHaveAttribute('href', workspace ? '/workspace/meetings/notes/n1' : '/notes/n1')
})
