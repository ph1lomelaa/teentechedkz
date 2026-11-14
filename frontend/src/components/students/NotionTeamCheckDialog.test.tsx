// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { NotionTeamCheckDialog } from './NotionTeamCheckDialog'

vi.mock('@/api/client', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {
  enabled: false,
  counts: { will_add: 1, unmatched: 1, removed: 1 },
  items: [
    { student_id: 's1', student_name: 'Асель', intake_year: 2027, role: 'lead', notion_name: 'Bibinur', state: 'will_add', user_id: 'u1', user_name: 'Бибинур', detail: '' },
    { student_id: 's1', student_name: 'Асель', intake_year: 2027, role: null, notion_name: 'Timur', state: 'unmatched', user_id: null, user_name: null, detail: 'найдено аккаунтов: 2' },
    { student_id: 's2', student_name: 'Бота', intake_year: 2027, role: 'ielts', notion_name: 'Zarina', state: 'removed', user_id: 'u2', user_name: 'Зарина', detail: '' },
  ],
} }) } }))

afterEach(cleanup)

it('показывает, кто добавится, и фильтрует спорные', async () => {
  const people = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotionTeamCheckDialog onClose={() => {}} onOpenPeople={people} /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByText(/Автодобавление пока выключено/)).toBeTruthy()
  expect(screen.getByText('Бибинур')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Аккаунт не найден · 1/ }))
  expect(screen.queryByText('Бибинур')).toBeNull()
  expect(screen.getByText('найдено аккаунтов: 2')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Открыть «Имена Notion/ }))
  expect(people).toHaveBeenCalled()
})
