import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportAll = vi.fn()
const previewExport = vi.fn(async (options: { student_ids?: string[]; restrict_to_ids?: boolean; columns: string[] }) => ({
  count: options.restrict_to_ids ? options.student_ids?.length ?? 0 : 2,
  columns: options.columns,
  rows: [],
}))
vi.mock('@/api/students', () => ({ studentsApi: {
  exportAll: (...args: unknown[]) => exportAll(...args),
  previewExport: (options: { student_ids?: string[]; restrict_to_ids?: boolean; columns: string[] }) => previewExport(options),
  facets: async () => ({ years: [{ value: '2027', count: 2 }], degrees: [{ value: 'undergraduate', count: 2 }], statuses: [{ value: 'active_work', count: 1 }], countries: [{ value: 'США', count: 2 }] }),
} }))
vi.mock('@/api/notion', () => ({ notionApi: { pipelineTable: async () => ({ items: [], columns: [] }) } }))
vi.mock('@/api/index', () => ({ usersApi: { list: async () => [] } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'export-test-user' }, can: () => true }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const { StudentExportDialog } = await import('./StudentExportDialog')

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><StudentExportDialog open onOpenChange={() => {}} currentView={{
    studentIds: ['crm-1', 'crm-2'], snapshotIds: ['snapshot-1'], selectedStudentIds: ['crm-1'], selectedNames: ['Алия'], labels: ['Вид: Мои', 'Поиск: «Алия»', 'Набор: 2027'], label: 'Мои',
  }} /></QueryClientProvider>)
}

describe('StudentExportDialog', () => {
  beforeEach(() => { localStorage.clear(); exportAll.mockReset().mockResolvedValue({ blob: new Blob(['Студент']), count: 1 }); previewExport.mockClear() })

  it('uses selected rows, previews the count, and copies TSV through the read-only export endpoint', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderDialog()
    expect(await screen.findByText(/1 строка · 8 столбцов/)).toBeInTheDocument()
    expect(screen.getByText('Алия')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    fireEvent.click(screen.getByRole('button', { name: /Скопировать 1 строк/ }))
    await waitFor(() => expect(exportAll).toHaveBeenCalledWith(expect.objectContaining({
      format: 'tsv', student_ids: ['crm-1'], restrict_to_ids: true, filename: expect.any(String),
    })))
  })

  it('passes unlinked Notion rows for the exact current overview', async () => {
    renderDialog()
    expect(await screen.findByText('Вся база')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Текущий вид/ }))
    await waitFor(() => expect(previewExport).toHaveBeenCalledWith(expect.objectContaining({
      student_ids: ['crm-1', 'crm-2'], snapshot_ids: ['snapshot-1'], restrict_to_ids: true,
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
    await waitFor(() => expect(previewExport).toHaveBeenCalledWith(expect.objectContaining({
      search: 'Алия', intake_years: ['2027'], restrict_to_ids: false,
    })))
  })
})
