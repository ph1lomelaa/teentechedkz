import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { roadmapApi, type Roadmap } from '@/api/roadmap'
import { ThemeProvider, THEME_STORAGE_KEY } from '@/contexts/ThemeContext'
import { WorkspaceRoadmapEditor } from './WorkspaceRoadmapEditor'

vi.mock('@/lib/motion', () => ({ withViewTransition: (fn: () => void) => fn() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'mentor', role: 'mentor' } }) }))
vi.mock('@/api/learnerTasks', () => ({ portfolioDocumentsApi: { list: () => Promise.resolve([]), link: vi.fn(), upload: vi.fn() } }))

const roadmap: Roadmap = {
  id: 'roadmap-1', student_id: 'student-1', mentor_id: null, template_id: 'template-1',
  name: 'Roadmap импортированный', country_name: 'Корея', degree: 'bachelors', year: 2027,
  status: 'active', created_at: '2026-01-01T00:00:00Z', country_flag_emoji: '', country_flag_url: '',
  stages: [{
    id: 'stage-1', roadmap_id: 'roadmap-1', name: 'Подготовка', description: '', position: 0,
    status: 'in_progress', visible_to_student: true, tasks_total: 1, required_total: 1, required_done: 0,
    can_complete: false, tasks: [{
      id: 'task-1', stage_id: 'stage-1', roadmap_id: 'roadmap-1', title: 'Исходное название',
      description: 'Старое описание', expected_result: '', needs_document: false, needs_zoom: false,
      questionnaire_url: null, priority: 'required', audience: 'applicant', visible_to_student: true,
      status: 'planned', review_status: 'none', completed_at: null, reviewed_at: null, review_comment: null,
      due_date: '2027-01-10', position: 0, subtasks: [],
    }],
  }],
}

describe('редактирование задачи roadmap', () => {
  beforeEach(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    vi.spyOn(roadmapApi, 'updateTask').mockResolvedValue(roadmap)
  })

  it('закрывает этап даже при незавершённых обязательных задачах', async () => {
    const updated = { ...roadmap, stages: [{ ...roadmap.stages[0], status: 'done' as const }] }
    const updateStage = vi.spyOn(roadmapApi, 'updateStage').mockResolvedValue(updated)
    const onChanged = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ThemeProvider><QueryClientProvider client={client}><WorkspaceRoadmapEditor roadmap={roadmap} onChanged={onChanged} /></QueryClientProvider></ThemeProvider>)
    fireEvent.click(screen.getByTitle('Сменить статус этапа'))
    await waitFor(() => expect(updateStage).toHaveBeenCalledWith('stage-1', { status: 'done' }))
    expect(onChanged).toHaveBeenCalledWith(updated)
  })

  it('сохраняет изменения импортированной задачи через существующий API', async () => {
    const onChanged = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ThemeProvider><QueryClientProvider client={client}><WorkspaceRoadmapEditor roadmap={roadmap} onChanged={onChanged} /></QueryClientProvider></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Изменить задачу «Исходное название»' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-theme', 'dark')
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Обновлённое название' } })
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Новое описание' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(roadmapApi.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      title: 'Обновлённое название', description: 'Новое описание', due_date: '2027-01-10',
      priority: 'required', audience: 'applicant', needs_document: false, needs_zoom: false,
    })))
    expect(onChanged).toHaveBeenCalledWith(roadmap)
  })

  it('передаёт светлую тему в портальное окно и его нативные списки', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ThemeProvider><QueryClientProvider client={client}><WorkspaceRoadmapEditor roadmap={roadmap} onChanged={vi.fn()} /></QueryClientProvider></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Изменить задачу «Исходное название»' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-theme', 'light')
  })
})

describe('порядок задач', () => {
  const task = roadmap.stages[0].tasks[0]
  const two: Roadmap = {
    ...roadmap,
    stages: [
      { ...roadmap.stages[0], tasks: [task, { ...task, id: 'task-2', title: 'Вторая', position: 1 }] },
      { ...roadmap.stages[0], id: 'stage-2', name: 'Эссе', position: 1, tasks: [] },
    ],
  }
  const show = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ThemeProvider><QueryClientProvider client={client}><WorkspaceRoadmapEditor roadmap={two} onChanged={vi.fn()} /></QueryClientProvider></ThemeProvider>)
  }

  it('двигает задачу кнопками, этапы не двигаются', async () => {
    const tasks = vi.spyOn(roadmapApi, 'reorderTasks').mockResolvedValue(two)
    show()
    expect(screen.queryByRole('button', { name: 'Опустить этап ниже' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Переместить задачу ниже' })[0])
    await waitFor(() => expect(tasks).toHaveBeenCalledWith('stage-1', ['task-2', 'task-1']))
  })

  it('перетаскивает задачу в другой этап', async () => {
    const tasks = vi.spyOn(roadmapApi, 'reorderTasks').mockResolvedValue(two)
    show()
    const grip = screen.getAllByTitle('Перетащить задачу (можно в другой этап)')[1]
    fireEvent.dragStart(grip, { dataTransfer: { effectAllowed: '' } })
    fireEvent.drop(screen.getByText('Эссе'))
    await waitFor(() => expect(tasks).toHaveBeenCalledWith('stage-2', ['task-2']))
  })
})

describe('материалы этапа', () => {
  it('один блок на этап, текст сохраняется в этап, у задач блока нет', async () => {
    const updateStage = vi.spyOn(roadmapApi, 'updateStage').mockResolvedValue(roadmap)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ThemeProvider><QueryClientProvider client={client}><WorkspaceRoadmapEditor roadmap={roadmap} onChanged={vi.fn()} /></QueryClientProvider></ThemeProvider>)
    expect(screen.getAllByRole('button', { name: /Материалы этапа/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Список и файлы/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Материалы этапа/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ написать список или заметку' }))
    const box = screen.getByLabelText('Материалы этапа «Подготовка»')
    fireEvent.change(box, { target: { value: '- Олимпиада\n- Волонтёрство' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.blur(box)
    expect(updateStage).not.toHaveBeenCalled()   // Enter и клик мимо поля не сохраняют
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(updateStage).toHaveBeenCalledWith('stage-1', { materials_text: '- Олимпиада\n- Волонтёрство' }))
  })
})
