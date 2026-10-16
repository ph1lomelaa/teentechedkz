import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { roadmapApi, type Roadmap } from '@/api/roadmap'
import { workspaceApi } from '@/api/workspace'
import { StudentRoadmapSection } from '@/components/shared/StudentRoadmapSection'
import { StudentDetailSections } from '@/components/students/detail/StudentDetailSections'
import { WorkspaceRoadmapPage } from '@/pages/workspace/WorkspaceRoadmapPage'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('@/hooks/useWorkspaceScope', () => ({ useWorkspaceScope: () => ({ params: {} }) }))
const dateAfter = (days: number) => {
  const date = new Date(); date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const roadmap: Roadmap = {
  id: 'r1', student_id: 's1', mentor_id: null, template_id: null, name: 'Исходная карта',
  country_name: 'США', degree: 'undergraduate', year: 2026, status: 'active', created_at: '',
  stages: [{ id: 'stage1', roadmap_id: 'r1', name: 'Документы', description: '', position: 0,
    status: 'in_progress', visible_to_student: true, tasks_total: 1, required_total: 1, required_done: 0, can_complete: false,
    tasks: [{ id: 't1', stage_id: 'stage1', roadmap_id: 'r1', title: 'Подготовить документы', description: '', expected_result: '',
      needs_document: false, needs_zoom: false, questionnaire_url: null, priority: 'required', audience: 'applicant',
      visible_to_student: true, status: 'planned', review_status: 'none', completed_at: null, reviewed_at: null, review_comment: null,
      due_date: dateAfter(-3), position: 0, subtasks: [{ id: 'sub1', title: 'Собрать справки', is_done: false, due_date: dateAfter(2), position: 0 }],
    }],
  }],
}
const clients: QueryClient[] = []
function mount(surface: 'workspace' | 'card') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  return render(<MemoryRouter initialEntries={[surface === 'card' ? '/students/s1#roadmap' : '/workspace/roadmap']}><ThemeProvider><QueryClientProvider client={client}>
    {surface === 'workspace' ? <WorkspaceRoadmapPage /> : <StudentDetailSections available={['roadmap']}><StudentRoadmapSection studentId="s1" /></StudentDetailSections>}
  </QueryClientProvider></ThemeProvider></MemoryRouter>)
}
beforeEach(() => {
  vi.spyOn(roadmapApi, 'studentRoadmaps').mockResolvedValue([roadmap])
  vi.spyOn(roadmapApi, 'listTemplates').mockResolvedValue([])
  vi.spyOn(workspaceApi, 'fullRoadmaps').mockResolvedValue({ items: [{ student: { id: 's1', full_name: 'Асель' }, roadmap }] } as Awaited<ReturnType<typeof workspaceApi.fullRoadmaps>>)
  vi.spyOn(roadmapApi, 'updateTask').mockResolvedValue(roadmap)
  vi.spyOn(roadmapApi, 'updateSubtask').mockResolvedValue(roadmap)
  vi.spyOn(roadmapApi, 'createTask').mockResolvedValue(roadmap)
  vi.spyOn(roadmapApi, 'createSubtask').mockResolvedValue(roadmap)
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks() })

describe.each(['workspace', 'card'] as const)('original Roadmap on %s surface', (surface) => {
  it('keeps each original screen presentation with the shared editing controls', async () => {
    const { container } = mount(surface)
    expect(await screen.findByText('Исходная карта')).toBeTruthy()
    if (surface === 'workspace') {
      expect(await screen.findByText('Просрочено: 1')).toBeTruthy()
      expect(screen.getByText('7 дней: 1')).toBeTruthy()
    } else {
      expect(screen.getByRole('heading', { name: 'Roadmap студента' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Исходная карта' })).toBeTruthy()
    }
    expect(screen.getAllByText(/Прогресс ·/)).toHaveLength(1)
    if (surface === 'workspace') expect(container.querySelector('[style*="radial-gradient"]')).toBeNull()
  })
  it('uses the original task deadline editor without altering the subtask deadline', async () => {
    mount(surface)
    const label = 'Срок задачи «Подготовить документы»'
    fireEvent.click(await screen.findByRole('button', { name: label }))
    fireEvent.change(screen.getByLabelText(label), { target: { value: dateAfter(5) } })
    await waitFor(() => expect(roadmapApi.updateTask).toHaveBeenCalledWith('t1', { due_date: dateAfter(5) }))
    expect(roadmapApi.updateSubtask).not.toHaveBeenCalled()
  })
  it('keeps the independent subtask deadline and warning when later than the task', async () => {
    mount(surface)
    const label = 'Срок подзадачи «Собрать справки»'
    fireEvent.click(await screen.findByRole('button', { name: label }))
    expect(screen.getByText('позже срока задачи')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(label), { target: { value: dateAfter(4) } })
    await waitFor(() => expect(roadmapApi.updateSubtask).toHaveBeenCalledWith('sub1', { due_date: dateAfter(4) }))
    expect(roadmapApi.updateTask).not.toHaveBeenCalled()
  })
  it('creates a task with its own deadline from the original editor', async () => {
    mount(surface)
    fireEvent.click(await screen.findByRole('button', { name: /Добавить задачу/ }))
    fireEvent.change(screen.getByPlaceholderText('Что нужно сделать'), { target: { value: 'Подать заявление' } })
    fireEvent.change(screen.getByRole('dialog').querySelector('input[type="date"]')!, { target: { value: dateAfter(10) } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(roadmapApi.createTask).toHaveBeenCalledWith(expect.objectContaining({ stage_id: 'stage1', title: 'Подать заявление', due_date: dateAfter(10) })))
  })
  it('creates a subtask with a separate deadline without changing its parent', async () => {
    mount(surface)
    fireEvent.click(await screen.findByRole('button', { name: /подзадача со сроком/ }))
    fireEvent.change(screen.getByPlaceholderText('Что нужно сделать'), { target: { value: 'Перевести справки' } })
    fireEvent.change(screen.getByRole('dialog').querySelector('input[type="date"]')!, { target: { value: dateAfter(6) } })
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }))
    await waitFor(() => expect(roadmapApi.createSubtask).toHaveBeenCalledWith('t1', 'Перевести справки', dateAfter(6)))
    expect(roadmapApi.updateTask).not.toHaveBeenCalled()
  })
})
