import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { TemplateEditor } from './TemplateEditor'
import { RoadmapTemplate, TemplateSaveInput } from '@/api/roadmap'

const mocks = vi.hoisted(() => ({ getTemplate: vi.fn(), saveTemplate: vi.fn(), toast: vi.fn() }))
vi.mock('@/api/roadmap', () => ({ roadmapApi: mocks }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
const template: RoadmapTemplate = {
  id: 'tpl', name: 'USA', country_name: 'США', degree: 'bachelors', year: 2027,
  description: 'Поступление', created_at: '2026-10-26', revision: 3, locally_edited: false,
  source_notion_db_id: 'notion-db', stages: [{
    id: 'stage', name: 'Подготовка', description: 'Начало', position: 0, tasks: [{
      id: 'task', title: 'Документы', description: 'Переводы', expected_result: 'Загружен паспорт',
      needs_document: true, needs_zoom: true, questionnaire_url: 'https://example.com/form',
      source_notion_page_id: 'notion-task', priority: 'required', audience: 'coordinator',
      position: 0, due_offset_days: 14, subtasks: [{ id: 'sub', title: 'Перевод', position: 0, due_offset_days: 7, source_notion_page_id: 'notion-sub' }],
    }],
  }],
}
function open() {
  const back = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><Link to="/elsewhere">Другой раздел</Link><TemplateEditor templateId="tpl" onBack={back} /></MemoryRouter></QueryClientProvider>)
  return back
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mocks.getTemplate.mockResolvedValue(structuredClone(template))
  mocks.saveTemplate.mockImplementation(async (_id: string, body: TemplateSaveInput) => ({ ...template, ...body, revision: 4, locally_edited: true }))
})
it('сохраняет общие настройки и все поля импортированных задач единым запросом', async () => {
  open()
  fireEvent.change(await screen.findByLabelText('Название шаблона'), { target: { value: 'USA 2028' } })
  fireEvent.change(screen.getByLabelText('Название задачи'), { target: { value: 'Паспорт' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
  await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledOnce())
  const [id, body] = mocks.saveTemplate.mock.calls[0]
  expect(id).toBe('tpl')
  expect(body).toMatchObject({ name: 'USA 2028', country_name: 'США', year: 2027, revision: 3 })
  expect(body.stages[0].tasks[0]).toMatchObject({ title: 'Паспорт', expected_result: 'Загружен паспорт', needs_document: true, needs_zoom: true, questionnaire_url: 'https://example.com/form', source_notion_page_id: 'notion-task', audience: 'coordinator', due_offset_days: 14, subtasks: [{ title: 'Перевод', due_offset_days: 7, source_notion_page_id: 'notion-sub' }] })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled())
})
it('переставляет этапы, задачи и подзадачи и сохраняет их порядок', async () => {
  const incoming = structuredClone(template)
  incoming.stages.push({ ...structuredClone(incoming.stages[0]), id: 's2', name: 'Подача', tasks: [] })
  incoming.stages[0].tasks.push({ ...structuredClone(incoming.stages[0].tasks[0]), id: 't2', title: 'Эссе', source_notion_page_id: null, subtasks: [] })
  incoming.stages[0].tasks[0].subtasks.push({ id: 'sub2', title: 'Скан', position: 1, due_offset_days: null })
  mocks.getTemplate.mockResolvedValue(incoming)
  open()
  await screen.findByLabelText('Название шаблона')
  fireEvent.click(screen.getByRole('button', { name: 'Подзадача 1.1.1: вниз' }))
  fireEvent.click(screen.getByRole('button', { name: 'Задача 1.1: вниз' }))
  fireEvent.click(screen.getByRole('button', { name: 'Этап 1: вниз' }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
  await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledOnce())
  const { stages } = mocks.saveTemplate.mock.calls[0][1]
  expect(stages.map((s: { name: string }) => s.name)).toEqual(['Подача', 'Подготовка'])
  expect(stages[1].tasks.map((t: { title: string }) => t.title)).toEqual(['Эссе', 'Документы'])
  expect(stages[1].tasks[1].subtasks.map((t: { title: string }) => t.title)).toEqual(['Скан', 'Перевод'])
})
it('добавляет и удаляет элементы без prompt', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  open(); await screen.findByLabelText('Название шаблона')
  fireEvent.click(screen.getByRole('button', { name: 'Добавить этап' }))
  const stage = screen.getByRole('region', { name: 'Этап 2' })
  fireEvent.change(within(stage).getByLabelText('Название этапа'), { target: { value: 'Admission' } })
  fireEvent.click(within(stage).getByRole('button', { name: 'Добавить задачу' }))
  fireEvent.change(within(stage).getByLabelText('Название задачи'), { target: { value: 'Подать заявку' } })
  fireEvent.click(within(stage).getByRole('button', { name: 'Добавить подзадачу' }))
  expect(within(stage).getByLabelText('Название подзадачи')).toHaveValue('')
  fireEvent.click(within(stage).getByRole('button', { name: 'Подзадача 2.1.1: удалить' }))
  expect(within(stage).queryByLabelText('Название подзадачи')).toBeNull()
  confirm.mockRestore()
})
it('предупреждает при выходе и обновлении страницы', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const back = open()
  fireEvent.change(await screen.findByLabelText('Название шаблона'), { target: { value: 'Изменено' } })
  fireEvent.click(screen.getByRole('button', { name: 'К списку шаблонов' }))
  expect(back).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: 'Другой раздел' }))
  expect(confirm).toHaveBeenCalledTimes(2)
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'К списку шаблонов' }))
  expect(back).toHaveBeenCalledOnce()
  confirm.mockRestore()
})
it('оставляет правки после ошибки и даёт повторить сохранение', async () => {
  mocks.saveTemplate.mockRejectedValueOnce(new Error('network'))
  open()
  fireEvent.change(await screen.findByLabelText('Название задачи'), { target: { value: 'Изменено' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
  expect(screen.getByLabelText('Название задачи')).toHaveValue('Изменено')
  expect(screen.getByRole('button', { name: 'Сохранить шаблон' })).toBeEnabled()
})
it('при конфликте версий блокирует перезапись и загружает текущую версию', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  mocks.saveTemplate.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Конфликт' } } })
  open()
  fireEvent.change(await screen.findByLabelText('Название шаблона'), { target: { value: 'Моя версия' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Другой сотрудник')
  expect(screen.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled()
  mocks.getTemplate.mockResolvedValue({ ...template, revision: 4, name: 'Чужая версия' })
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить текущую версию' }))
  await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Чужая версия'))
  expect(screen.queryByRole('alert')).toBeNull()
  confirm.mockRestore()
})
it('не позволяет сохранить пустые названия и отрицательный срок', async () => {
  open()
  fireEvent.change(await screen.findByLabelText('Название задачи'), { target: { value: '   ' } })
  expect((screen.getByLabelText('Название задачи') as HTMLInputElement).checkValidity()).toBe(false)
  fireEvent.change(screen.getByLabelText('Название задачи'), { target: { value: 'Документы' } })
  const task = screen.getByRole('group', { name: 'Задача 1.1' })
  const input = within(task).getAllByLabelText('Срок после назначения, дней')[0] as HTMLInputElement
  fireEvent.change(input, { target: { value: '-1' } })
  expect(input.checkValidity()).toBe(false)
})
it('при ошибке загрузки не показывает сохранение пустой структуры', async () => {
  mocks.getTemplate.mockRejectedValue(new Error('network'))
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить')
  expect(screen.queryByRole('button', { name: 'Сохранить шаблон' })).toBeNull()
})

it('восстанавливает черновик после возврата через историю браузера', async () => {
  sessionStorage.setItem('roadmap-template-draft:tpl', JSON.stringify({
    name: 'Несохранённый шаблон', year: 2027, revision: 3, stages: [],
  }))
  open()
  expect(await screen.findByLabelText('Название шаблона')).toHaveValue('Несохранённый шаблон')
  expect(screen.getByText('Восстановлены несохранённые изменения из этой вкладки.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Сохранить шаблон' })).toBeEnabled()
})
it('устаревший восстановленный черновик требует загрузить текущую версию', async () => {
  sessionStorage.setItem('roadmap-template-draft:tpl', JSON.stringify({
    name: 'Устаревший черновик', year: 2027, revision: 2, stages: [],
  }))
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent('Другой сотрудник')
  expect(screen.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled()
})
