import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { notesApi } from '@/api/notes'
import { UploadRecordPanel } from './UploadRecordPanel'
import { UploadStatusView } from './UploadStatusView'
import type { NoteSessionDetail } from '@/types'

vi.mock('@/api/notes', () => ({ notesApi: { importDrive: vi.fn(), uploadAudio: vi.fn() } }))
const session = { id: 'session1', student_id: 'student1', language: 'ru', capture_mode: 'browser', status: 'draft', transcripts: [] } as unknown as NoteSessionDetail
const link = 'https://drive.google.com/file/d/abc123def456ghi789/view'
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider> }
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear() })
it('starts Drive import for the selected student session and language', async () => {
  const onUploaded = vi.fn()
  vi.mocked(notesApi.importDrive).mockResolvedValue({ ...session, capture_mode: 'upload', bot_status: 'downloading' })
  render(<UploadRecordPanel session={session} inWorkspace source="drive" onUploaded={onUploaded} />, { wrapper })
  expect(screen.getByRole('button', { name: 'Импортировать и собрать конспект' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Ссылка на запись Google Drive'), { target: { value: link } })
  fireEvent.click(screen.getByRole('radio', { name: 'English' }))
  fireEvent.click(screen.getByRole('button', { name: 'Импортировать и собрать конспект' }))
  await waitFor(() => expect(notesApi.importDrive).toHaveBeenCalledWith('session1', link, 'en'))
  await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
  expect(notesApi.uploadAudio).not.toHaveBeenCalled()
})
it('shows access errors and keeps the link for retry', async () => {
  vi.mocked(notesApi.importDrive).mockRejectedValueOnce(new Error('Нет доступа к записи'))
  render(<UploadRecordPanel session={session} inWorkspace source="drive" onUploaded={vi.fn()} />, { wrapper })
  fireEvent.change(screen.getByLabelText('Ссылка на запись Google Drive'), { target: { value: link } })
  fireEvent.click(screen.getByRole('button', { name: 'Импортировать и собрать конспект' }))
  expect(await screen.findByText('Нет доступа к записи')).toBeVisible()
  expect(screen.getByLabelText('Ссылка на запись Google Drive')).toHaveValue(link)
  expect(screen.getByRole('button', { name: 'Импортировать и собрать конспект' })).toBeEnabled()
})
it('prevents a second start while the first request is pending', async () => {
  let finish!: (value: typeof session) => void
  vi.mocked(notesApi.importDrive).mockReturnValue(new Promise(resolve => { finish = resolve }))
  render(<UploadRecordPanel session={session} inWorkspace source="drive" onUploaded={vi.fn()} />, { wrapper })
  fireEvent.change(screen.getByLabelText('Ссылка на запись Google Drive'), { target: { value: link } })
  const button = screen.getByRole('button', { name: 'Импортировать и собрать конспект' })
  fireEvent.click(button)
  await waitFor(() => expect(button).toBeDisabled())
  fireEvent.click(button)
  expect(notesApi.importDrive).toHaveBeenCalledOnce()
  finish(session)
  await waitFor(() => expect(button).toBeEnabled())
})
it('retains selected file and Drive link when switching sources', async () => {
  const props = { session, inWorkspace: true, onUploaded: vi.fn() }
  const { container, rerender } = render(<UploadRecordPanel {...props} source="file" />, { wrapper })
  const file = new File(['audio'], 'meeting.mp3', { type: 'audio/mpeg' })
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
  rerender(<UploadRecordPanel {...props} source="drive" />)
  fireEvent.change(screen.getByLabelText('Ссылка на запись Google Drive'), { target: { value: link } })
  rerender(<UploadRecordPanel {...props} source="file" />)
  expect(screen.getByText('meeting.mp3')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить и собрать конспект' }))
  await waitFor(() => expect(notesApi.uploadAudio).toHaveBeenCalledWith('session1', file, 'ru', expect.any(Function)))
})
it('rejects documents without calling transcription', () => {
  const { container } = render(<UploadRecordPanel session={session} inWorkspace onUploaded={vi.fn()} />, { wrapper })
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })] } })
  expect(screen.getByRole('button', { name: 'Загрузить и собрать конспект' })).toBeDisabled()
  expect(notesApi.uploadAudio).not.toHaveBeenCalled()
})
it.each([['downloading', 'Скачиваем запись из Google Drive…'], ['transcribing', 'Распознаём речь…'], ['processing', 'Создаём конспект…']] as const)('shows persisted stage %s after returning to a session', (bot_status, title) => {
  render(<UploadStatusView session={{ ...session, bot_status }} inWorkspace onDelete={vi.fn()} onUploaded={vi.fn()} />, { wrapper })
  expect(screen.getByText(title)).toBeVisible()
  expect(screen.getByText(/Страницу можно закрыть/)).toBeVisible()
})
it('offers both retry methods after a failed import', () => {
  render(<UploadStatusView session={{ ...session, bot_status: 'failed', bot_status_message: 'Нет доступа' }} inWorkspace onDelete={vi.fn()} onUploaded={vi.fn()} />, { wrapper })
  expect(screen.getByText('Нет доступа')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Повторить из Google Drive' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Загрузить запись' })).toBeVisible()
})
