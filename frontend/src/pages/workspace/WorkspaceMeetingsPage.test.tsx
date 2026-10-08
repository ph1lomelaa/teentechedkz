import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceMeetingsPage } from './WorkspaceMeetingsPage'

const mocks = vi.hoisted(() => ({ students: vi.fn(), meetings: vi.fn(), notes: vi.fn(), create: vi.fn(), update: vi.fn(), session: vi.fn() }))
vi.mock('@/api/workspace', () => ({ workspaceApi: { students: mocks.students, meetings: mocks.meetings, notes: mocks.notes } }))
vi.mock('@/api/meetings', () => ({ meetingsApi: { create: mocks.create, update: mocks.update } }))
vi.mock('@/api/notes', () => ({ notesApi: { createSession: mocks.session } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

function open(path = '/workspace/meetings') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[path]}><WorkspaceMeetingsPage /></MemoryRouter></QueryClientProvider>)
}
const meeting = (id: string, minutes: number, status = 'scheduled') => ({ id, student_id: 's1', student_name: 'Анна Тест', title: `Встреча ${id}`, meeting_type: 'regular', description: '', meeting_link: 'https://meet.google.com/test', starts_at: new Date(Date.now() + minutes * 60000).toISOString(), ends_at: new Date(Date.now() + (minutes + 60) * 60000).toISOString(), status, recording_url: '', transcript_url: '' })
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  mocks.students.mockResolvedValue({ items: [{ student: { id: 's1', full_name: 'Анна Тест' } }] })
  mocks.meetings.mockResolvedValue({ items: [] }); mocks.notes.mockResolvedValue({ sessions: [] })
  mocks.create.mockResolvedValue({ id: 'created' }); mocks.update.mockResolvedValue({})
})
afterEach(cleanup)

it('создание доступно в пустом состоянии, проверяет обязательные поля и подставляет название', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Новая встреча' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()
  expect(dialog.getByText('Выберите дату и время')).toBeTruthy()
  fireEvent.change(dialog.getByLabelText('Студент'), { target: { value: 's1' } })
  fireEvent.change(dialog.getByLabelText('Дата и время'), { target: { value: '2026-10-04T15:30' } })
  fireEvent.change(dialog.getByLabelText('Длительность в минутах'), { target: { value: '0.5' } })
  expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('Длительность в минутах'), { target: { value: '45' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Создать' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
  const body = mocks.create.mock.calls[0][0]
  expect(body.title).toBe('Регулярный: Анна Тест')
  expect(Date.parse(body.ends_at) - Date.parse(body.starts_at)).toBe(45 * 60000)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('вход из карточки выбирает студента и ошибка сохранения оставляет форму открытой', async () => {
  mocks.create.mockRejectedValue(new Error('API unavailable'))
  open('/workspace/meetings?student_id=s1')
  const dialog = within(await screen.findByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Студент')).toHaveValue('s1'))
  fireEvent.change(dialog.getByLabelText('Дата и время'), { target: { value: '2026-10-04T15:30' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Создать' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('разделяет встречи и открывает вход за 10 минут, показывает реальные конспекты', async () => {
  mocks.meetings.mockResolvedValue({ items: [meeting('soon', 5), meeting('later', 30), meeting('past', -120), meeting('noted', -180), meeting('cancelled', 15, 'cancelled')] })
  mocks.notes.mockResolvedValue({ sessions: [{ id: 'session', meeting_id: 'noted', note_id: 'note', has_audio: true, transcript_count: 1 }] })
  open(); await screen.findByText('Встреча soon')
  expect(screen.getAllByRole('button', { name: 'Новая встреча' })).toHaveLength(1)
  const join = screen.getAllByRole('button', { name: 'Войти' })
  expect(join[0]).toBeEnabled(); expect(join[1]).toBeDisabled()
  fireEvent.click(screen.getByRole('tab', { name: /Прошедшие/ }))
  expect(screen.getByRole('button', { name: 'Открыть конспект' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Без конспекта (1)' }))
  expect(screen.getByText('Встреча past')).toBeTruthy(); expect(screen.queryByText('Встреча noted')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: /Отменённые/ }))
  expect(screen.getByText('Встреча cancelled')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Войти' })).toBeNull()
})

it('редактирует через существующий API, отменяет встречу', async () => {
  mocks.meetings.mockResolvedValue({ items: [meeting('edit', 30)] })
  open(); await screen.findByText('Встреча edit')
  fireEvent.click(screen.getByText('Изменить'))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Название встречи'), { target: { value: 'Обновлённая встреча' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('edit', expect.objectContaining({ title: 'Обновлённая встреча' })))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByText('Отменить'))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('edit', { status: 'cancelled' }))
})

it('ошибка загрузки конспектов не маскируется пустым списком', async () => {
  mocks.notes.mockRejectedValue(new Error('Нет связи'))
  open(); expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('Встреч пока нет')).toBeNull()
})

it('неверная ссылка не даёт войти, а «Конспект» заводит сессию встречи', async () => {
  mocks.meetings.mockResolvedValue({ items: [{ ...meeting('broken', 5), meeting_link: 'ss' }] })
  mocks.notes.mockResolvedValue({ sessions: [] })
  mocks.session.mockResolvedValue({ id: 'new-session' })
  const open$ = vi.spyOn(window, 'open').mockReturnValue(null)
  open(); await screen.findByText('Встреча broken')
  expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
  expect(screen.getByTitle(/Ссылка указана неверно/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Конспект' }))
  await waitFor(() => expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ student_id: 's1', meeting_id: 'broken', source: 'meeting' })))
  expect(open$).not.toHaveBeenCalled()
  open$.mockRestore()
})

it('диалог не принимает мусор вместо ссылки и дополняет схему', async () => {
  mocks.meetings.mockResolvedValue({ items: [] }); mocks.notes.mockResolvedValue({ sessions: [] })
  mocks.create.mockResolvedValue({ id: 'created' })
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Новая встреча' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Студент'), { target: { value: 's1' } })
  fireEvent.change(dialog.getByLabelText('Дата и время'), { target: { value: '2026-10-04T15:30' } })
  const field = dialog.getByLabelText('Ссылка на встречу')
  fireEvent.change(field, { target: { value: 'ss' } })
  expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()
  fireEvent.change(field, { target: { value: 'zoom.us/j/123' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Создать' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ meeting_link: 'https://zoom.us/j/123' })))
})
