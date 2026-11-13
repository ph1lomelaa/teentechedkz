// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NoteSessionDetail } from '@/types'
import { TextNotePanel } from './TextNotePanel'

const mocks = vi.hoisted(() => ({ add: vi.fn(), finalize: vi.fn() }))
vi.mock('@/api/notes', () => ({ notesApi: { addTranscript: mocks.add, finalizeSession: mocks.finalize } }))

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.add.mockResolvedValue({}); mocks.finalize.mockResolvedValue({ note: { id: 'n1' } }) })
afterEach(cleanup)

const show = (onDone = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><TextNotePanel session={{ id: 's1' } as NoteSessionDetail} inWorkspace onDone={onDone} /></QueryClientProvider>)
  return onDone
}

it('сохраняет пометки как написано, без ИИ', async () => {
  const done = show()
  expect(screen.getByRole('button', { name: /Сохранить конспект/ })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Текст конспекта'), { target: { value: '- выбрали 8 активностей' } })
  fireEvent.click(screen.getByLabelText(/Сохранить как написано/))
  fireEvent.click(screen.getByRole('button', { name: /Сохранить конспект/ }))
  await waitFor(() => expect(mocks.finalize).toHaveBeenCalledWith('s1', { use_ai: false }))
  expect(mocks.add).toHaveBeenCalledWith('s1', expect.objectContaining({ text: '- выбрали 8 активностей' }))
  await waitFor(() => expect(done).toHaveBeenCalledWith({ id: 'n1' }))
})

it('по умолчанию собирает конспект с ИИ', async () => {
  show()
  fireEvent.change(screen.getByLabelText('Текст конспекта'), { target: { value: 'обсудили эссе' } })
  fireEvent.click(screen.getByRole('button', { name: /Сохранить конспект/ }))
  await waitFor(() => expect(mocks.finalize).toHaveBeenCalledWith('s1', { use_ai: true }))
})
