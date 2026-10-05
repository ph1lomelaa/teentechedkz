import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toDateKey } from '@/components/workspace/tasks/workItems'

/**
 * «Новая задача»: два действия.
 *  - «Студенту» — шаг roadmap со сроком (его студент видит в кабинете);
 *  - «Сотруднику» — поручение; рассылка и общая задача зависят от прав (can), а не роли.
 */
const BASE = ['tasks:manage', 'tasks_deadlines:manage', 'roadmaps:edit']
const PERMS = {
  admin: [...BASE, 'tasks_bulk:manage', 'tasks_general:manage'],
  mentor: BASE,
  noRoadmap: ['tasks:manage', 'tasks_deadlines:manage'],
} as const
let granted: readonly string[] = PERMS.admin

const create = vi.fn()
const createBulk = vi.fn()
const toast = vi.fn()
const studentsList = vi.fn()
const studentRoadmaps = vi.fn()
const createRoadmapTask = vi.fn()
const listByStudent = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ can: (r: string, a: string) => granted.includes(`${r}:${a}`) }),
}))
vi.mock('@/hooks/use-toast', () => ({ toast: (...a: unknown[]) => toast(...a) }))
vi.mock('@/api', () => ({
  tasksApi: { create: (...a: unknown[]) => create(...a), createBulk: (...a: unknown[]) => createBulk(...a) },
  usersApi: {
    list: vi.fn(async ({ role }: { role: string }) =>
      role === 'mentor'
        ? [{ id: 'm1', name: 'Ментор Один', role: 'mentor' }, { id: 'm2', name: 'Ментор Два', role: 'mentor' }]
        : [],
    ),
  },
  mentorAssignmentsApi: { listByStudent: (...a: unknown[]) => listByStudent(...a) },
}))
vi.mock('@/api/roadmap', () => ({
  roadmapApi: {
    studentRoadmaps: (...a: unknown[]) => studentRoadmaps(...a),
    createTask: (...a: unknown[]) => createRoadmapTask(...a),
  },
}))
vi.mock('@/api/students', () => ({ studentsApi: { list: (...a: unknown[]) => studentsList(...a) } }))

const { CreateTaskDialog } = await import('./CreateTaskDialog')

function open(props: { initialKind?: 'student' | 'staff' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreateTaskDialog colorPrefix="w" onClose={vi.fn()} onCreated={onCreated} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onCreated }
}

async function pickStudent() {
  fireEvent.change(screen.getByLabelText('Поиск студента по имени'), { target: { value: 'Алим' } })
  fireEvent.click(await screen.findByRole('option', { name: 'Алимов Бекзат' }))
}

const title = () => screen.getByLabelText('Что нужно сделать')

beforeEach(() => {
  vi.clearAllMocks()
  granted = PERMS.admin
  studentsList.mockResolvedValue({ items: [{ id: 's1', full_name: 'Алимов Бекзат' }] })
  studentRoadmaps.mockResolvedValue([
    {
      id: 'rm1', name: 'Италия', status: 'active',
      stages: [
        { id: 'st-done', name: 'Анкета', position: 0, status: 'done' },
        { id: 'st-open', name: 'Подготовка', position: 1, status: 'planned' },
      ],
    },
    { id: 'rm0', name: 'Старый', status: 'archived', stages: [{ id: 'st-old', name: 'Старый этап', position: 0, status: 'done' }] },
  ])
})

describe('задача студенту', () => {
  it('открывается на «Студенту»: студент, что сделать, срок — без выбора исполнителей', () => {
    open()
    expect(screen.getByRole('tab', { name: 'Студенту' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Поиск студента по имени')).toBeInTheDocument()
    expect(title()).toBeInTheDocument()
    expect(screen.queryByText('Исполнители')).toBeNull()
    expect(screen.getByRole('button', { name: 'Поставить студенту' })).toBeDisabled()
  })

  it('ставит шаг roadmap в первый незавершённый этап активного roadmap, со сроком', async () => {
    createRoadmapTask.mockResolvedValue({})
    const { onCreated } = open()
    await pickStudent()
    fireEvent.change(title(), { target: { value: 'Загрузить скан паспорта' } })
    fireEvent.change(screen.getByLabelText('Срок'), { target: { value: 'tomorrow' } })
    const submit = screen.getByRole('button', { name: 'Поставить студенту' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(onCreated).toHaveBeenCalled())

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(studentRoadmaps).toHaveBeenCalledWith('s1')
    expect(createRoadmapTask).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_id: 'st-open',
        title: 'Загрузить скан паспорта',
        audience: 'applicant',
        due_date: toDateKey(tomorrow),
      }),
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('срок — список: готовые варианты, «Без срока», «Вручную» в конце; календарь только после «Вручную»', () => {
    open()
    const select = screen.getByLabelText('Срок') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      'Сегодня', 'Завтра', 'Через 3 дня', 'Через неделю', 'Через 2 недели', 'Без срока', 'Вручную…',
    ])
    expect(select.value).toBe('none')
    expect(screen.queryByLabelText('Дата срока')).toBeNull()
    fireEvent.change(select, { target: { value: 'manual' } })
    expect(screen.getByLabelText('Дата срока')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'none' } })
    expect(screen.queryByLabelText('Дата срока')).toBeNull()
  })

  it('без активного roadmap объясняет почему и не даёт отправить', async () => {
    studentRoadmaps.mockResolvedValue([])
    open()
    await pickStudent()
    fireEvent.change(title(), { target: { value: 'Что-то' } })
    expect(await screen.findByText(/нет активного roadmap/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Поставить студенту' })).toBeDisabled()
  })

  it('«Поставить как поручение сотруднику» переключает на второй режим', async () => {
    studentRoadmaps.mockResolvedValue([])
    open()
    await pickStudent()
    fireEvent.click(await screen.findByRole('button', { name: 'Поставить как поручение сотруднику' }))
    expect(screen.getByRole('tab', { name: 'Сотруднику' })).toHaveAttribute('aria-selected', 'true')
  })

  it('403 показывает понятное сообщение, а не «Request failed»', async () => {
    createRoadmapTask.mockRejectedValue({ response: { status: 403, data: {} }, message: 'Request failed with status code 403' })
    const { onCreated } = open()
    await pickStudent()
    fireEvent.change(title(), { target: { value: 'Задача' } })
    const submit = screen.getByRole('button', { name: 'Поставить студенту' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0][0].title).toMatch(/Недостаточно прав/)
    expect(toast.mock.calls[0][0].variant).toBe('destructive')
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe('поручение сотруднику', () => {
  it('после выбора студента менторов, которые его не ведут, отметить нельзя', async () => {
    listByStudent.mockResolvedValue([
      { mentor_id: 'm1', is_active: true, assignment_status: 'active' },
      { mentor_id: 'm2', is_active: false, assignment_status: 'replaced' },
    ])
    open({ initialKind: 'staff' })
    await pickStudent()
    await waitFor(() => expect(listByStudent).toHaveBeenCalledWith('s1'))
    const one = await screen.findByRole('checkbox', { name: /Ментор Один/ })
    const two = screen.getByRole('checkbox', { name: /Ментор Два/ })
    await waitFor(() => expect(two).toBeDisabled())
    expect(one).not.toBeDisabled()
    expect(screen.getByText('Не ведёт ученика')).toBeInTheDocument()
    expect(screen.getByText('Ведёт')).toBeInTheDocument()
  })

  it('admin видит режимы рассылки; «Все менторы» уходит через /tasks/bulk без студента', async () => {
    createBulk.mockResolvedValue({ created: [], skipped: [], created_count: 1 })
    const { onCreated } = open({ initialKind: 'staff' })
    expect(screen.getByRole('tab', { name: 'Все менторы' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Все МЗК' })).toBeInTheDocument()
    fireEvent.change(title(), { target: { value: 'Сдать отчёт' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Все менторы' }))
    const submit = screen.getByRole('button', { name: 'Создать задачу' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(createBulk).toHaveBeenCalledWith(expect.objectContaining({ all_mentors: true, student_id: null }))
    expect(createRoadmapTask).not.toHaveBeenCalled()
  })

  it('ментор: без рассылки, студент обязателен, уходит через POST /tasks со сроком', async () => {
    granted = PERMS.mentor
    create.mockResolvedValue({ id: 't1' })
    const { onCreated } = open({ initialKind: 'staff' })
    expect(screen.queryByText('Исполнители')).toBeNull()
    fireEvent.change(title(), { target: { value: 'Проверить документы' } })
    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeDisabled()
    await pickStudent()
    fireEvent.change(screen.getByLabelText('Срок'), { target: { value: 'manual' } })
    fireEvent.change(screen.getByLabelText('Дата срока'), { target: { value: '2099-01-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith('s1', { task_text: 'Проверить документы', due_date: '2099-01-05' })
    expect(createBulk).not.toHaveBeenCalled()
  })

  it('без права править roadmap переключателя нет — только поручение', () => {
    granted = PERMS.noRoadmap
    open()
    expect(screen.queryByRole('tab', { name: 'Студенту' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeInTheDocument()
  })
})
