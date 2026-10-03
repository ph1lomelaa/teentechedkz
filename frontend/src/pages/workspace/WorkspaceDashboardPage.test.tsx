import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceDashboardPage } from './WorkspaceDashboardPage'

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), roadmapTasks: vi.fn() }))
vi.mock('@/api/workspace', () => ({ workspaceApi: { dashboard: mocks.dashboard, roadmapTasks: mocks.roadmapTasks } }))
vi.mock('@/api/notes', () => ({ notesApi: { createSession: vi.fn() } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { name: '[ТЕСТ] Админ Иванов' } }) }))

const stats = { students_total: 2, active_work: 2, open_roadmap_tasks: 0, open_internal_tasks: 0, upcoming_meetings: 0, without_roadmap: 1, telegram_signals: 0, documents_total: 0, documents_unverified: 0, ai_drafts: 0, security_incidents: 0 }
const summary = (id: string, name: string, roadmapId: string | null) => ({ student: { id, full_name: name, degree_level: 'bachelor', intake_year: 2026, has_portal_access: false }, primary_mentor: null, my_roles: [], roadmap: { id: roadmapId, name: null, country_name: null, year: null, tasks_total: 0, tasks_done: 0, progress: 0 }, open_roadmap_tasks: 0, open_internal_tasks: 0, next_meeting: null, documents: { total: 0, unverified: 0 }, telegram: { linked: false, pending_signals: 0 }, notes: { sessions: 0, ai_drafts: 0 }, warnings: [] })

function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><WorkspaceDashboardPage /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.dashboard.mockResolvedValue({ stats, students: [summary('a', 'Анна', 'r'), summary('b', 'Борис', null)], upcoming_meetings: [], attention: [], workload: [] })
  mocks.roadmapTasks.mockImplementation(async (p: { review_status?: string }) => (p.review_status ? { items: [], total: 0 } : { items: [], total: 0 }))
})
afterEach(cleanup)

it('приветствует по имени без префикса, баннер про roadmap, встреч нет', async () => {
  open()
  expect(await screen.findByText('1 студенту не назначен roadmap')).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/, Админ$/)
  expect(screen.getByText('Встреч пока не запланировано.')).toBeTruthy()
  expect(screen.getByText('1 в работе · 1 без roadmap')).toBeTruthy()
})

it('проверка важнее roadmap, ближайшая встреча с кнопками', async () => {
  mocks.roadmapTasks.mockImplementation(async (p: { review_status?: string }) => (p.review_status ? { items: [], total: 3 } : { items: [], total: 0 }))
  const startsAt = new Date(Date.now() + 20 * 60_000).toISOString()
  mocks.dashboard.mockResolvedValue({ stats, students: [summary('a', 'Анна', 'r'), summary('b', 'Борис', null)], upcoming_meetings: [{ student: summary('a', 'Анна', 'r').student, meeting: { id: 'm', title: 'Разбор эссе', starts_at: startsAt, meeting_link: 'zoom.us/j/1' } }], attention: [], workload: [] })
  open()
  expect(await screen.findByText('3 работы ждут проверки')).toBeTruthy()
  expect(screen.queryByText('1 студенту не назначен roadmap')).toBeNull()
  expect(screen.getByText(/^через (19|20) мин$/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Войти' }).getAttribute('href')).toBe('https://zoom.us/j/1')
  expect(screen.getByRole('button', { name: 'Конспект' })).toBeTruthy()
})
