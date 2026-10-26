import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Activity } from '@/api/activities'
import { ActivityComposer } from './ActivityComposer'

const mocks = vi.hoisted(() => ({ createFull: vi.fn(), save: vi.fn(), saveTemplate: vi.fn(), template: vi.fn(), intakes: vi.fn(), duplicates: vi.fn(), duplicate: vi.fn(), nextSeason: vi.fn() }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
const created = { id: 'a1', title: 'Олимпиада', publication: 'published', experience_type: 'competitions', experience_explicit: true } as Activity
function open(activity: Activity | null = null, onSaved = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <ActivityComposer activity={activity} catalog={[]} editable presetType="competitions" onSaved={onSaved} onDuplicated={vi.fn()} /></QueryClientProvider>)
  return onSaved
}
const openMenu = () => {
  const trigger = screen.getByRole('button', { name: 'Другие действия' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.createFull.mockResolvedValue(created); mocks.duplicates.mockResolvedValue([]); mocks.template.mockResolvedValue([]); mocks.intakes.mockResolvedValue([])
  mocks.save.mockResolvedValue(created); mocks.saveTemplate.mockResolvedValue([])
})

it('новая активность с набором и типовыми шагами сохраняется одним запросом и сразу ведёт к выдаче', async () => {
  const onSaved = open()
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Олимпиада по физике' } })
  expect(screen.getByRole('radio', { name: 'Олимпиады' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.change(screen.getByLabelText('Дедлайн организатора'), { target: { value: '2030-11-01' } })
  fireEvent.click(screen.getByRole('button', { name: /Типовые шаги/ }))
  // Пока не хватает полей, «Опубликовать» недоступна.
  expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Ссылка организатора'), { target: { value: 'https://example.org' } })
  fireEvent.change(screen.getByLabelText('О чём это'), { target: { value: 'Олимпиада для старшеклассников' } })
  fireEvent.change(screen.getByLabelText('Стоимость'), { target: { value: 'free' } })
  expect(screen.getByText('Готово к публикации')).toBeInTheDocument()
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Опубликовать и рекомендовать' }))
  await waitFor(() => expect(mocks.createFull).toHaveBeenCalledTimes(1))
  const body = mocks.createFull.mock.calls[0][0]
  expect(body.activity).toMatchObject({ title: 'Олимпиада по физике', publication: 'published', experience_type: 'competitions' })
  expect(body.intake).toMatchObject({ mode: 'fixed', deadline: '2030-11-01' })
  expect(body.steps[0]).toMatchObject({ title: 'Зарегистрироваться у организатора', days_before_deadline: 30 })
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, 'recommend'))
})
it('черновик без сроков не создаёт пустой набор', async () => {
  open()
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Идея на потом' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Пока неизвестно' }))
  expect(screen.getByText(/Не хватает:/)).toBeInTheDocument()
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Сохранить черновик' }))
  await waitFor(() => expect(mocks.createFull).toHaveBeenCalled())
  expect(mocks.createFull.mock.calls[0][0]).toMatchObject({ intake: null, steps: [], activity: { publication: 'draft' } })
})
it('предупреждает о похожей активности в каталоге', async () => {
  mocks.duplicates.mockResolvedValue([{ id: 'x', title: 'Олимпиада по физике', publication: 'published', reason: 'title' }])
  open()
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Олимпиада по физике' } })
  expect(await screen.findByText('Похожее уже есть в каталоге', {}, { timeout: 2000 })).toBeInTheDocument()
})
it('у существующей активности шаблон сохраняется только если его меняли', async () => {
  mocks.template.mockResolvedValue([{ title: 'Регистрация', description: '', expected_result: '', priority: 'required', requires_review: false, requires_evidence: false, days_before_deadline: 7, subtasks: [] }])
  open({ ...created, publication: 'published' })
  expect(await screen.findByDisplayValue('Регистрация')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  expect(mocks.saveTemplate).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Шаг 1'), { target: { value: 'Регистрация на сайте' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledWith('a1', [expect.objectContaining({ title: 'Регистрация на сайте' })]))
})
