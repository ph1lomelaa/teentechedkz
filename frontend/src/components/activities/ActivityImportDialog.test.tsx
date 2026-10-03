import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActivityImportDialog } from './ActivityImportDialog'
const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn() }))
vi.mock('@/api/activities', () => ({ activityImportApi: mocks }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.preview.mockResolvedValue({ skipped: 5, rows: [
    { row: 2, activity: { title: 'Конкурс' }, source: { sheet: 'База', raw: {} }, errors: [], warnings: ['Нет ссылки организатора'] },
    { row: 6, activity: null, source: { sheet: 'База', raw: { 'Наименование': 'https://example.com' } }, errors: ['Нужно название'], warnings: [] },
  ] })
  mocks.commit.mockResolvedValue({ imported_rows: [2], skipped_rows: [] })
})
it('показывает ошибки и отправляет только выбранные допустимые строки', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ActivityImportDialog onClose={vi.fn()} /></QueryClientProvider>)
  const file = new File(['test'], 'base.xlsx')
  fireEvent.change(screen.getByLabelText(/Файл XLSX/), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }))
  await screen.findByText('Нужно название')
  const checkboxes = screen.getAllByRole('checkbox')
  expect(checkboxes[0]).toBeChecked()
  expect(checkboxes[1]).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Загрузить в черновики/ }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith(file, [2]))
  expect(await screen.findByRole('status')).toHaveTextContent('Сохранено черновиков: 1')
})
