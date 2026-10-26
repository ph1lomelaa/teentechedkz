import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActivitiesPage } from './ActivitiesPage'
import { PortalActivityDetailPage } from './portal/PortalActivityDetailPage'
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), intakes: vi.fn(), plan: vi.fn(), tasks: vi.fn(), select: vi.fn(), editPlan: vi.fn(), recommend: vi.fn(), assign: vi.fn(), staffStudents: vi.fn(), staffMentors: vi.fn(), overview: vi.fn(), board: vi.fn(), participation: vi.fn(), submissions: vi.fn(), summary: vi.fn(), studentsOverview: vi.fn(), user: { role: 'student' } }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, can: () => mocks.user.role !== 'student' }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const intake = { id: 'i1', activity_id: 'a1', label: 'Осень', mode: 'unknown', cost_state: 'unknown', deadline: null }
const activity = { id: 'a1', title: 'Конкурс проектов', publication: 'published', description: 'Свой проект', kind: 'Конкурс', direction: '№3 — IT', next_intake: intake, intake_count: 1 }
const participation = { id: 'p1', student_id: 's1', intake_id: 'i1', student_name: 'Ученик', activity, intake, decision: 'selected', status: 'in_progress', steps: { total: 0, done: 0, pending: 0, returned: 0, overdue: 0, next: null } }
const counts = { active: 0, suggested: 0, confirmed: 0, waiting_mentor: 0, waiting_student: 0, overdue: 0 }
const emptySummary = { focus: null, counts, experience: [{ key: 'research', label: 'Исследования и проекты', confirmed: 0, active: 0 }], next_deadline: null, actions: [], mentor_actions: [] }
const board = { items: [], total: 0, counts: { all: 0, waiting: 0, due_soon: 0, closed: 0 }, columns: {} }
function ParticipationDestination() { return <p>Открытое участие</p> }
function TaskDestination() { const { search } = useLocation(); return <p>Открытая задача: {new URLSearchParams(search).get('task_id')}</p> }
function StudentCardDestination() { const { id } = useParams(); const { search, hash } = useLocation(); return <p>Карточка: {id} {search} {hash}</p> }
function open(path = '/portal/activities') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/portal/activities/:activityId" element={<PortalActivityDetailPage />} /><Route path="/portal/activities/participations/:participationId" element={<ParticipationDestination />} /><Route path="/portal/tasks" element={<TaskDestination />} /><Route path="/workspace/students/:id" element={<StudentCardDestination />} /><Route path="*" element={<ActivitiesPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.user.role = 'student'; mocks.list.mockResolvedValue([activity]); mocks.get.mockResolvedValue(activity); mocks.intakes.mockResolvedValue([intake]); mocks.overview.mockResolvedValue(board); mocks.plan.mockResolvedValue([]); mocks.tasks.mockResolvedValue([]); mocks.submissions.mockResolvedValue({}); mocks.select.mockResolvedValue({}); mocks.editPlan.mockResolvedValue({}); mocks.recommend.mockResolvedValue({}); mocks.assign.mockResolvedValue({ results: [{ student_id: 's1', status: 'created', participation_id: 'p1' }] }); mocks.staffMentors.mockResolvedValue([]); mocks.summary.mockResolvedValue(emptySummary); mocks.studentsOverview.mockResolvedValue([]); mocks.staffStudents.mockResolvedValue([{ id: 's1', name: 'Ученик' }]) })
it('ученик выбирает из каталога и не запрашивает список чужих учеников', async () => {
  open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить в план: Конкурс проектов' }))
  await waitFor(() => expect(mocks.select).toHaveBeenCalledWith('i1'))
  expect(mocks.staffStudents).not.toHaveBeenCalled()
})
it('подробнее открывает полную карточку с регистрацией отдельно', async () => {
  open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: /Подробнее/ }))
  expect(await screen.findByRole('button', { name: 'Добавить в план' })).toBeEnabled()
  expect(screen.getByText(/ещё не регистрация/)).toBeTruthy()
})
it('повторный выбор заменён меткой «В моём плане»', async () => {
  mocks.plan.mockResolvedValue([participation]); open('/portal/activities?view=catalog')
  expect(await screen.findByText('В плане')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Добавить в план: Конкурс проектов' })).toBeNull()
  expect(mocks.select).not.toHaveBeenCalled()
})
it('рекомендация принимает существующее участие вместо POST дубля', async () => {
  mocks.plan.mockResolvedValue([{ ...participation, decision: 'suggested', recommendation_note: 'Для твоего проекта' }]); open('/portal/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить в план: Конкурс проектов' }))
  await waitFor(() => expect(mocks.editPlan).toHaveBeenCalledWith('p1', { decision: 'selected' }, true))
  expect(mocks.select).not.toHaveBeenCalled()
})
it('ментор выдаёт рекомендацию через конструктор с причиной и личным сроком', async () => {
  mocks.user.role = 'mentor'; mocks.list.mockResolvedValue([{ ...activity, publication: 'draft' }]); open('/workspace/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: /Черновики/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Конкурс проектов' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Рекомендовать' }))
  fireEvent.change(await screen.findByLabelText('Способ выдачи'), { target: { value: 'suggested' } })
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.change(screen.getByLabelText('Пояснение ученику'), { target: { value: 'Для проекта' } })
  fireEvent.change(screen.getByLabelText('Личный срок участия'), { target: { value: '2030-10-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: /Рекомендовать · 1/ }))
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(expect.objectContaining({ intake_id: 'i1', decision: 'suggested', recommendation_note: 'Для проекта', recipients: [{ student_id: 's1', personal_deadline: '2030-10-15', steps: [] }] })))
})
it('повторная выдача сообщает о существующем участии и сохраняет его план', async () => {
  mocks.user.role = 'mentor'; mocks.assign.mockResolvedValue({ results: [{ student_id: 's1', status: 'existing', participation_id: 'p1' }] }); open('/workspace/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Конкурс проектов' })); fireEvent.click(screen.getByRole('tab', { name: 'Рекомендовать' }))
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Далее' })); fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: /Назначить · 1/ }))
  expect(await screen.findByText('Участие уже существует — план сохранён')).toBeInTheDocument()
})
const boardData = { declined: 1, declined_students: [{ activity_id: 'a1', student_id: 's2', name: 'Бекзат', participation_id: 'p9' }], columns: [
  { key: 'recommendation', items: [] },
  { key: 'in_work', items: [{ activity_id: 'a1', title: 'Конкурс проектов', experience_type: 'competitions', submit_deadline: null,
    students: [{ student_id: 's1', name: 'Алина', participation_id: 'p1', step_index: 2, step_total: 3, step_done: 1, step_pending: 1, next_title: 'Эссе', due: null, overdue_days: 0, needs_me: true }] }] },
  { key: 'result_review', items: [] }, { key: 'achievement', items: [] }] }
it('канбан: колонка — активность, в ней ученики; клик ведёт в карточку ученика на эту активность', async () => {
  mocks.user.role = 'mentor'
  mocks.board.mockResolvedValue(boardData)
  open('/workspace/activities')
  const column = await screen.findByRole('region', { name: 'Конкурс проектов' })
  expect(within(column).getByText('Проверить шаг')).toBeTruthy()
  expect(within(column).getByText('Шаг 2 из 3: Эссе')).toBeTruthy()
  expect(within(column).getByText('Отказались · 1')).toBeTruthy()
  fireEvent.click(within(column).getByRole('button', { name: 'Путь: Алина · Конкурс проектов' }))
  expect(await screen.findByText('Карточка: s1 ?p=p1 #portfolio')).toBeTruthy()
})
it('список учеников раскрывается, как Roadmap: внутри активности ученика с шагами', async () => {
  mocks.user.role = 'mentor'
  mocks.studentsOverview.mockResolvedValue([
    { student_id: 's1', name: 'Алина', focus_set: true, focus_text: 'Медицина', counts: { confirmed: 0 }, experience_confirmed: [] },
    { student_id: 's3', name: 'Дана', focus_set: false, counts: { confirmed: 0 }, experience_confirmed: [] }])
  mocks.plan.mockResolvedValue([{ ...participation, activity: { ...activity, title: 'Конкурс проектов' } }])
  open('/workspace/activities?view=students')
  fireEvent.click(await screen.findByRole('button', { name: /Алина/ }))
  expect(await screen.findByRole('button', { name: /Конкурс проектов/ })).toBeTruthy()
  expect(mocks.plan).toHaveBeenCalledWith('s1')
  expect(screen.queryByRole('button', { name: /Нужно от меня/ })).toBeNull()
  expect(mocks.board).not.toHaveBeenCalled()
})
const action = (kind: string, extra = {}) => ({ kind, owner: 'student', participation_id: 'p1', activity_title: 'Конкурс проектов', student_id: 's1', student_name: 'Ученик', step_id: 't1', step_title: 'Эссе', due_date: null, overdue: false, ...extra })
it('«Сейчас» начинается с самого срочного действия и ведёт в нужный шаг', async () => {
  mocks.plan.mockResolvedValue([participation])
  mocks.summary.mockResolvedValue({ ...emptySummary, actions: [action('fix_step'), action('do_step', { participation_id: 'p2', step_title: 'Регистрация' })] }); open()
  const now = await screen.findByRole('region', { name: 'Сейчас' })
  expect(within(now).getAllByRole('listitem')[0]).toHaveTextContent('Исправьте шаг «Эссе»')
  fireEvent.click(within(now).getByRole('link', { name: 'Исправить' }))
  expect(await screen.findByText('Открытое участие')).toBeTruthy()
})
it('если действие за ментором, «Сейчас» не предлагает повторную отправку', async () => {
  mocks.plan.mockResolvedValue([participation])
  mocks.summary.mockResolvedValue({ ...emptySummary, actions: [action('step_waiting', { owner: 'mentor' })] }); open()
  const now = await screen.findByRole('region', { name: 'Сейчас' })
  expect(within(now).getByText('Шаг на проверке')).toBeTruthy()
  expect(within(now).queryByRole('button')).toBeNull()
  expect(within(now).queryByRole('link', { name: /Отправ|Исправ/ })).toBeNull()
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
  mocks.user.role = 'mentor'; open('/workspace/activities?view=catalog')
  fireEvent.click(await screen.findByRole('button', { name: 'Карточками' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }))
  expect(screen.getByRole('tab', { name: 'Как увидит ученик' })).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByText('Что нужно сделать')).toBeTruthy()
  expect(mocks.select).not.toHaveBeenCalled()
  expect(mocks.recommend).not.toHaveBeenCalled()
})
it('инструкция назначения доступна сотруднику внутри модуля', async () => {
  mocks.user.role = 'mentor'; open('/workspace/activities?view=catalog')
  const summary = await screen.findByText('Как работать с портфолио учеников')
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveAttribute('open')
  expect(screen.getByText('3. Шаги')).toBeTruthy()
  expect(screen.getByText(/Итог участия|Подтвердить итог/)).toBeTruthy()
})
