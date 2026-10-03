import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceStudentsPage } from './WorkspaceStudentsPage'

const mocks = vi.hoisted(() => ({ students: vi.fn() }))
vi.mock('@/api/workspace', () => ({ workspaceApi: { students: mocks.students } }))
vi.mock('@/api/notes', () => ({ notesApi: { createSession: vi.fn() } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const base = { primary_mentor: null, my_roles: ['lead'], open_internal_tasks: 0, next_meeting: null, documents: { total: 0, unverified: 0 }, telegram: { linked: false, pending_signals: 0 }, notes: { sessions: 0, ai_drafts: 0 }, warnings: [] }
const roadmap = { id: 'r', name: 'США 2026', country_name: null, year: 2026, tasks_total: 4, tasks_done: 1, progress: 25 }
const items = [
  { ...base, student: { id: 'a', full_name: 'Анна Активная', degree_level: 'bachelor', intake_year: 2026, has_portal_access: false, phone: '+7 700 1' }, roadmap, open_roadmap_tasks: 3 },
  { ...base, student: { id: 'b', full_name: 'Борис Безроудмапа', degree_level: 'bachelor', intake_year: 2026, has_portal_access: false }, roadmap: { ...roadmap, id: null, name: null, progress: 0 }, open_roadmap_tasks: 0 },
]

let location = ''
function Spy() { location = useLocation().pathname + useLocation().search; return null }
function open(path = '/workspace/students') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<><WorkspaceStudentsPage /><Spy /></>} /></Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.students.mockResolvedValue({ items, total: 2 })
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

it('по срочности первым идёт студент без roadmap, панель показывает следующий шаг', async () => {
  open()
  const panel = await screen.findByRole('complementary', { name: 'Студент Борис Безроудмапа' })
  expect(within(panel).getByText('Roadmap ещё не назначен')).toBeTruthy()
  expect(within(panel).getByRole('link', { name: 'Назначить roadmap' }).getAttribute('href')).toBe('/workspace/students/b#roadmap')
  expect(screen.queryByRole('group', { name: 'Фильтр студентов' })).toBeNull()
})

it('клик по студенту меняет панель и пишет выбор в адрес, ?s= восстанавливает выбор', async () => {
  open()
  fireEvent.click(await screen.findByRole('button', { name: /Анна Активная/ }))
  const panel = await screen.findByRole('complementary', { name: 'Студент Анна Активная' })
  expect(within(panel).getByText('США 2026')).toBeTruthy()
  expect(location).toBe('/workspace/students?s=a')
  cleanup(); open('/workspace/students?s=a')
  expect(await screen.findByRole('complementary', { name: 'Студент Анна Активная' })).toBeTruthy()
})

it('поиск сужает список, на узком экране клик ведёт в карточку', async () => {
  open()
  await screen.findByRole('button', { name: /Борис/ })
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск студентов' }), { target: { value: 'Борис' } })
  await waitFor(() => expect(screen.queryByRole('button', { name: /Анна Активная/ })).toBeNull())
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
  fireEvent.click(screen.getByRole('button', { name: /Борис/ }))
  expect(location).toBe('/workspace/students/b')
})
