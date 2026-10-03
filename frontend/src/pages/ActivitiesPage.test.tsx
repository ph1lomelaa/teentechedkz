import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActivitiesPage } from './ActivitiesPage'
import { PortalActivityDetailPage } from './portal/PortalActivityDetailPage'
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), intakes: vi.fn(), plan: vi.fn(), tasks: vi.fn(), select: vi.fn(), editPlan: vi.fn(), recommend: vi.fn(), staffStudents: vi.fn(), overview: vi.fn(), user: { role: 'student' } }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, can: () => mocks.user.role !== 'student' }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const intake = { id: 'i1', activity_id: 'a1', label: 'Осень', mode: 'unknown', cost_state: 'unknown', deadline: null }
const activity = { id: 'a1', title: 'Конкурс проектов', publication: 'published', description: 'Свой проект', kind: 'Конкурс', direction: '№3 — IT', next_intake: intake, intake_count: 1 }
const participation = { id: 'p1', student_id: 's1', intake_id: 'i1', student_name: 'Ученик', activity, intake, decision: 'selected', status: 'in_progress', steps: { total: 0, done: 0, pending: 0, returned: 0, overdue: 0, next: null } }
const board = { items: [], total: 0, counts: { all: 0, waiting: 0, due_soon: 0, closed: 0 }, columns: {} }
function TaskDestination() { const { search } = useLocation(); return <p>Открытая задача: {new URLSearchParams(search).get('task_id')}</p> }
function open(path = '/portal/activities') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/portal/activities/:activityId" element={<PortalActivityDetailPage />} /><Route path="/portal/tasks" element={<TaskDestination />} /><Route path="*" element={<ActivitiesPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.user.role = 'student'; mocks.list.mockResolvedValue([activity]); mocks.get.mockResolvedValue(activity); mocks.intakes.mockResolvedValue([intake]); mocks.overview.mockResolvedValue(board); mocks.plan.mockResolvedValue([]); mocks.tasks.mockResolvedValue([]); mocks.select.mockResolvedValue({}); mocks.editPlan.mockResolvedValue({}); mocks.recommend.mockResolvedValue({}); mocks.staffStudents.mockResolvedValue([{ id: 's1', name: 'Ученик' }]) })
it('ученик выбирает из каталога и не запрашивает список чужих учеников', async () => {
  open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить в план: Конкурс проектов' }))
  await waitFor(() => expect(mocks.select).toHaveBeenCalledWith('i1'))
  expect(mocks.staffStudents).not.toHaveBeenCalled()
})
it('подробнее открывает полную карточку с регистрацией отдельно', async () => {
  open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: /Подробнее/ }))
  expect(await screen.findByRole('button', { name: 'Добавить в мой план' })).toBeEnabled()
  expect(screen.getByText(/ещё не регистрация/)).toBeTruthy()
})
it('повторный выбор заменён меткой «В моём плане»', async () => {
  mocks.plan.mockResolvedValue([participation]); open('/portal/activities?view=catalog')
  expect(await screen.findByText('В моём плане')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Добавить в план: Конкурс проектов' })).toBeNull()
  expect(mocks.select).not.toHaveBeenCalled()
})
it('рекомендация принимает существующее участие вместо POST дубля', async () => {
  mocks.plan.mockResolvedValue([{ ...participation, decision: 'suggested', recommendation_note: 'Для твоего проекта' }]); open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить в план' }))
  await waitFor(() => expect(mocks.editPlan).toHaveBeenCalledWith('p1', { decision: 'selected' }, true))
  expect(mocks.select).not.toHaveBeenCalled()
})
it('ментор рекомендует черновик с причиной и личным сроком', async () => {
  mocks.user.role = 'mentor'; mocks.list.mockResolvedValue([{ ...activity, publication: 'draft' }]); open('/workspace/activities')
  fireEvent.click(await screen.findByRole('button', { name: 'Конкурс проектов' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Рекомендовать' }))
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.change(screen.getByLabelText('Причина · увидит ученик'), { target: { value: 'Для проекта' } })
  fireEvent.change(screen.getByLabelText('Личный срок'), { target: { value: '2030-10-15' } })
  fireEvent.click(screen.getByRole('button', { name: /Рекомендовать ученикам/ }))
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledWith('s1', { intake_id: 'i1', decision: 'suggested', recommendation_note: 'Для проекта', personal_deadline: '2030-10-15' }))
})
it('существующее участие блокирует повторную рекомендацию', async () => {
  mocks.user.role = 'mentor'; mocks.overview.mockResolvedValue({ ...board, items: [{ ...participation, column: 'in_work' }], total: 1 }); open('/workspace/activities')
  fireEvent.click(await screen.findByRole('button', { name: 'Конкурс проектов' })); fireEvent.click(screen.getByRole('tab', { name: 'Рекомендовать' }))
  expect(await screen.findByRole('checkbox')).toBeDisabled()
  expect(screen.getByText('Участие уже есть')).toBeTruthy()
  expect(mocks.recommend).not.toHaveBeenCalled()
})
it('доска раскладывает карточки по колонкам API и по умолчанию ждёт действия ментора', async () => {
  mocks.user.role = 'mentor'; mocks.overview.mockResolvedValue({ ...board, items: [{ ...participation, column: 'planning' }], total: 1, counts: { ...board.counts, waiting: 1, all: 1 } }); open('/workspace/activities?view=overview')
  const column = await screen.findByRole('region', { name: 'Выбрано' })
  expect(within(column).getByText('Конкурс проектов')).toBeTruthy()
  expect(within(column).getByRole('button', { name: 'Составить план' })).toBeTruthy()
  await waitFor(() => expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ view: 'waiting' })))
})
it('следующий шаг — ближайшая задача среди разных участий', async () => {
  const step = (id: string, title: string, due: string) => ({ ...participation, id, activity: { ...activity, title: id }, steps: { ...participation.steps, total: 1, next: { id, title, due_date: due, state: 'todo' } } })
  mocks.plan.mockResolvedValue([step('p1', 'Поздний шаг', '2030-11-01'), step('p2', 'Ближайший шаг', '2030-10-15')]); open()
  const card = await screen.findByRole('region', { name: 'Следующий шаг' })
  expect(within(card).getByText('Ближайший шаг')).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: 'Отправить работу' }))
  expect(await screen.findByText('Открытая задача: p2')).toBeTruthy()
})
it('если всё на проверке, следующий шаг не предлагает повторную отправку', async () => {
  mocks.plan.mockResolvedValue([{ ...participation, steps: { ...participation.steps, total: 1, pending: 1, next: { id: 't1', title: 'Эссе', due_date: null, state: 'pending' } } }]); open()
  const card = await screen.findByRole('region', { name: 'Следующий шаг' })
  expect(within(card).getByText('Работа отправлена, ждём ответ ментора')).toBeTruthy()
  expect(within(card).queryByRole('button')).toBeNull()
})
it('ошибка плана показана как ошибка с повтором', async () => {
  mocks.plan.mockRejectedValue(new Error('Нет связи')); open()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('План начинается с интереса')).toBeNull()
})

it('отменённое участие не выглядит доступным для повторного добавления', async () => {
  mocks.plan.mockResolvedValue([{ ...participation, status: 'cancelled' }]); open('/portal/activities?view=catalog')
  expect(await screen.findByRole('button', { name: /Участие в этом наборе отменено/ })).toBeDisabled()
  expect(mocks.select).not.toHaveBeenCalled()
})
it('новый набор можно выбрать после отказа от предыдущего', async () => {
  mocks.plan.mockResolvedValue([{ ...participation, decision: 'not_interested', intake_id: 'old-intake' }]); open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить в план: Конкурс проектов' }))
  await waitFor(() => expect(mocks.select).toHaveBeenCalledWith('i1'))
  expect(mocks.editPlan).not.toHaveBeenCalled()
})

it('ментор видит карточки и открывает превью без назначения ученику', async () => {
  mocks.user.role = 'mentor'; open('/workspace/activities')
  fireEvent.click(await screen.findByRole('button', { name: 'Карточками' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }))
  expect(screen.getByRole('tab', { name: 'Превью' })).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByText('Кто может участвовать')).toBeTruthy()
  expect(mocks.select).not.toHaveBeenCalled()
  expect(mocks.recommend).not.toHaveBeenCalled()
})
it('инструкция назначения доступна сотруднику внутри модуля', async () => {
  mocks.user.role = 'mentor'; open('/workspace/activities')
  const summary = await screen.findByText('Как работать с активностями')
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveAttribute('open')
  expect(screen.getByText('4. Рекомендовать ученикам')).toBeTruthy()
  expect(screen.getByText(/Личный срок хранится отдельно/)).toBeTruthy()
})
