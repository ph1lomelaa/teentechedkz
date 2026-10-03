import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

let granted: string[] = []

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ can: (r: string, a: string) => granted.includes(`${r}:${a}`) }),
}))
vi.mock('@/hooks/useWorkspaceScope', () => ({ useWorkspaceScope: () => ({ params: {} }) }))
vi.mock('@/api', () => ({
  tasksApi: { listAll: vi.fn(async () => ({ items: [] })), update: vi.fn() },
  usersApi: { list: vi.fn(async () => []) },
}))
vi.mock('@/api/workspace', () => ({
  workspaceApi: {
    roadmapTasks: vi.fn(async () => ({ items: [] })),
    students: vi.fn(async () => ({ items: [{ student: { id: 's1', full_name: 'Алимов Бекзат' }, open_roadmap_tasks: 0, open_internal_tasks: 0 }] })),
  },
}))
vi.mock('@/api/students', () => ({ studentsApi: { list: vi.fn(async () => ({ items: [] })) } }))

const { WorkspaceTasksPage } = await import('./WorkspaceTasksPage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><WorkspaceTasksPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WorkspaceTasksPage: кнопка «Новая задача»', () => {
  it.each([
    ['admin', ['tasks:manage', 'tasks_bulk:manage']],
    ['mzk_manager', ['tasks:manage', 'tasks_bulk:manage']],
    ['mentor', ['tasks:manage']],
  ])('%s с правом tasks:manage видит кнопку', (_role, perms) => {
    granted = perms
    renderPage()
    expect(screen.getByRole('button', { name: /Новая задача/ })).toBeInTheDocument()
  })

  it('без права tasks:manage кнопки нет', () => {
    granted = []
    renderPage()
    expect(screen.queryByRole('button', { name: /Новая задача/ })).toBeNull()
  })

  it('«Задача» у студента без задач открывает диалог с этим студентом', async () => {
    granted = ['tasks:manage']
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /По студентам/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Поставить задачу: Алимов Бекзат' }))
    expect(await screen.findByText('Новая задача', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByLabelText('Убрать студента')).toBeInTheDocument()
    expect(screen.getAllByText('Алимов Бекзат').length).toBeGreaterThan(1)
  })
})
