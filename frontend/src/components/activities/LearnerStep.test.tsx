import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { LearnerStep } from './LearnerStep'
import type { RoadmapTask } from '@/api/roadmap'
const mocks = vi.hoisted(() => ({ complete: vi.fn(), review: vi.fn(), user: { role: 'student' } }))
vi.mock('@/api/learnerTasks', () => ({ learnerTasksApi: mocks }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, can: () => true }) }))
vi.mock('./PortfolioFiles', () => ({ PortfolioFiles: ({ editable }: { editable: boolean }) => <p>{editable ? 'Можно прикрепить файл' : 'Файлы доступны для просмотра'}</p> }))
const task = { id: 't1', title: 'Регистрация', stage_id: null, roadmap_id: null, description: '', expected_result: '', status: 'planned', review_status: 'none', priority: 'required', due_date: null, subtasks: [], requires_review: false, needs_document: false, needs_zoom: false, questionnaire_url: null, audience: 'applicant', visible_to_student: true, completed_at: null, reviewed_at: null, review_comment: null, position: 0 } as RoadmapTask
function open(patch: Partial<RoadmapTask> = {}, closed = false) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><LearnerStep task={{ ...task, ...patch }} closed={closed} defaultOpen /></QueryClientProvider>)
}
beforeEach(() => { vi.clearAllMocks(); mocks.user.role = 'student'; mocks.complete.mockResolvedValue({}); mocks.review.mockResolvedValue({}) })
it('ученик самостоятельно завершает простой шаг и передаёт пояснение', async () => {
  open()
  fireEvent.change(screen.getByLabelText('Результат или пояснение'), { target: { value: 'Зарегистрировалась' } })
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith('t1', 'Зарегистрировалась'))
  expect(screen.queryByRole('button', { name: 'Отправить на проверку' })).toBeNull()
})
it('на проверке файлы недоступны для изменения, ученик может отозвать работу', () => {
  open({ requires_review: true, review_status: 'pending' })
  expect(screen.getByText('Файлы доступны для просмотра')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Отозвать с проверки' })).toBeEnabled()
  expect(screen.queryByLabelText('Результат или пояснение')).toBeNull()
})
it('ментор не может вернуть работу без комментария', async () => {
  mocks.user.role = 'mentor'
  open({ requires_review: true, review_status: 'pending', activity_participation_id: 'p1' })
  const back = screen.getByRole('button', { name: 'Вернуть на правки' })
  expect(back).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Комментарий к проверке'), { target: { value: 'Добавьте подтверждение' } })
  fireEvent.click(back)
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('t1', 'return', 'Добавьте подтверждение'))
})
it('закрытое участие сохраняет материалы и не предлагает выполнение', () => {
  open({}, true)
  expect(screen.getByText('Файлы доступны для просмотра')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull()
})
