import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { roadmapApi, type Roadmap } from '@/api/roadmap'
import { WorkspaceRoadmapEditor } from './WorkspaceRoadmapEditor'

vi.mock('@/lib/motion', () => ({ withViewTransition: (fn: () => void) => fn() }))

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
  beforeEach(() => vi.spyOn(roadmapApi, 'updateTask').mockResolvedValue(roadmap))

  it('сохраняет изменения импортированной задачи через существующий API', async () => {
    const onChanged = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><WorkspaceRoadmapEditor roadmap={roadmap} onChanged={onChanged} /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Изменить задачу «Исходное название»' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Обновлённое название' } })
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Новое описание' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(roadmapApi.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      title: 'Обновлённое название', description: 'Новое описание', due_date: '2027-01-10',
      priority: 'required', audience: 'applicant', needs_document: false, needs_zoom: false,
    })))
    expect(onChanged).toHaveBeenCalledWith(roadmap)
  })
})
