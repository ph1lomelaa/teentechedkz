import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceRoadmapTask } from '@/api/workspace'
import type { StudentTask } from '@/types'
import { fromDelegated, fromRoadmap } from './workItems'

const updateTask = vi.fn()
const updateSubtask = vi.fn()
const createSubtask = vi.fn()
const deleteSubtask = vi.fn()
const studentRoadmaps = vi.fn()

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/api/roadmap', () => ({
  roadmapApi: {
    studentRoadmaps: (...a: unknown[]) => studentRoadmaps(...a),
    updateTask: (...a: unknown[]) => updateTask(...a),
    updateSubtask: (...a: unknown[]) => updateSubtask(...a),
    createSubtask: (...a: unknown[]) => createSubtask(...a),
    deleteSubtask: (...a: unknown[]) => deleteSubtask(...a),
  },
}))

const { TaskDetailPanel } = await import('./TaskDetailPanel')

const row: WorkspaceRoadmapTask = {
  id: 't1', student_id: 's1', student_name: 'Алимов Бекзат', roadmap_id: 'rm', stage_name: 'Onboarding', stage_position: 0,
  title: 'Создание расписания', status: 'planned', priority: 'recommended', audience: 'applicant', due_date: '2099-06-10',
  needs_document: false, needs_zoom: false, has_questionnaire: false, questionnaire_url: null,
  subtasks_total: 3, subtasks_done: 0, position: 0, review_status: 'none', completed_at: null, reviewed_at: null, review_comment: null,
}

const sub = (id: string, title: string, due: string | null, position: number, done = false) => ({
  id, title, is_done: done, due_date: due, position,
})

const noActions = {
  busyKey: null,
  onToggleRoadmap: vi.fn(), onApproveRoadmap: vi.fn(), onReview: vi.fn(), onDelegatedStatus: vi.fn(),
  onEvidence: vi.fn(), onQuestionnaire: vi.fn(), onOpen: vi.fn(),
}

function open(item: ReturnType<typeof fromRoadmap>, onChanged = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskDetailPanel item={item} actions={noActions} onClose={vi.fn()} onChanged={onChanged} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [updateTask, updateSubtask, createSubtask, deleteSubtask]) fn.mockResolvedValue({})
  studentRoadmaps.mockResolvedValue([
    {
      id: 'rm', status: 'active', name: 'Италия',
      stages: [{
        id: 'st', name: 'Onboarding', position: 0, status: 'planned',
        tasks: [{
          id: 't1', title: 'Создание расписания', description: 'Собрать загрузку', expected_result: 'Документ', due_date: '2099-06-10', status: 'planned',
          review_status: 'none', review_comment: null,
          subtasks: [
            sub('a', 'Без срока', null, 0),
            sub('b', 'Поздняя', '2099-07-01', 1),
            sub('c', 'Ранняя', '2099-06-01', 2),
          ],
        }],
      }],
    },
  ])
})

describe('TaskDetailPanel: шаг roadmap', () => {
  it('подзадачи идут по сроку, без срока в конце; поздняя помечена', async () => {
    open(fromRoadmap(row))
    const list = (await screen.findByText('Ранняя')).closest('ul')!
    const titles = within(list).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))
    expect(titles).toEqual(['Выполнено: Ранняя', 'Выполнено: Поздняя', 'Выполнено: Без срока'])
    expect(within(list).getAllByText('позже срока задачи')).toHaveLength(1)
    expect(screen.getByText('Собрать загрузку')).toBeInTheDocument()
    expect(screen.getByText('Документ')).toBeInTheDocument()
  })

  it('отметка подзадачи и добавление новой уходят на сервер, страница узнаёт об изменении', async () => {
    const { onChanged } = open(fromRoadmap(row))
    fireEvent.click(await screen.findByLabelText('Выполнено: Ранняя'))
    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('c', { is_done: true }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Новая подзадача'), { target: { value: 'Позвонить' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(createSubtask).toHaveBeenCalledWith('t1', 'Позвонить', null))
  })

  it('срок задачи меняется из панели', async () => {
    open(fromRoadmap(row))
    fireEvent.click(await screen.findByRole('button', { name: 'Срок задачи' }))
    const input = await screen.findByLabelText('Срок задачи')
    fireEvent.change(input, { target: { value: '2099-06-20' } })
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('t1', { due_date: '2099-06-20' }))
  })
})

describe('TaskDetailPanel: поручение', () => {
  const task: StudentTask = {
    id: 'd1', student_id: 's1', student_name: 'Алимов Бекзат', assignee_name: 'Ментор Аида', task_text: 'Собрать документы',
    status: 'in_progress', created_by: 'u', created_at: '2026-09-01T00:00:00Z', due_date: '2099-06-10',
    acceptance_criteria: 'Все сканы читаемы', required_documents: ['Паспорт'],
  }

  it('показывает подробности и не показывает подзадачи и редактор срока', () => {
    open(fromDelegated(task))
    expect(screen.getByText('Все сканы читаемы')).toBeInTheDocument()
    expect(screen.getByText('Паспорт')).toBeInTheDocument()
    expect(screen.queryByText('Подзадачи')).toBeNull()
    expect(screen.queryByLabelText('Срок задачи')).toBeNull()
    expect(studentRoadmaps).not.toHaveBeenCalled()
  })
})
