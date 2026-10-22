import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NotionSyncReportPanel } from './NotionSyncReportPanel'
import { syncApi, type NotionFieldReport } from '@/api/sync'

vi.mock('@/api/sync', () => ({ syncApi: { notionFieldReport: vi.fn(), applyNotionFieldReport: vi.fn() } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
function report(): NotionFieldReport {
  return { can_refresh: false, revision: 'revision-1', enabled: true, dry_run: true, fresh: true, students: 2, ready: 1, review: 1,
    pilot_students: 0, duplicate_students: 0, directions: { notion: 1 }, queue_counts: { dry_run: 3 },
    last_read: { ok: true, at: '2026-10-18T10:57:00Z' }, excluded: [], rows: [
      { snapshot_id: 'page1', student_id: 'student1', student_name: 'Первый студент', fields: [
        { field_key: 'client_remaining_date', label: 'Дата остатка', crm: '2026-09-28', notion: '2026-07-17', decision: 'notion_changed', winner: 'notion', eligible: true, allowed_sides: ['notion', 'crm'], reason: null },
      ] },
      { snapshot_id: 'page2', student_id: 'student2', student_name: 'Второй студент', fields: [
        { field_key: 'phone', label: 'Телефон', crm: '111', notion: '222', decision: 'conflict', winner: null, eligible: false, allowed_sides: ['notion', 'crm'], reason: 'Обе стороны изменились' },
      ] },
    ] }
}
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><NotionSyncReportPanel /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.mocked(syncApi.notionFieldReport).mockResolvedValue(report())
  vi.mocked(syncApi.applyNotionFieldReport).mockResolvedValue({ queued: 1, review: 1, dry_run: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('Whole-base Notion preflight', () => {
  it('queues the reviewed revision for all unambiguous fields', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Обработать однозначные (1)' }))
    await waitFor(() => expect(syncApi.applyNotionFieldReport).toHaveBeenCalledWith('revision-1', []))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('проверка без записи'))
  })
  it('sends only explicitly selected conflicts with the chosen source', async () => {
    mount()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать Телефон: Второй студент' }))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить выбранные (1)' }))
    await waitFor(() => expect(syncApi.applyNotionFieldReport).toHaveBeenCalledWith('revision-1', [{ snapshot_id: 'page2', field_key: 'phone', side: 'notion' }]))
  })
  it.each(['disabled', 'stale'])('blocks writes when %s', async (mode) => {
    vi.mocked(syncApi.notionFieldReport).mockResolvedValue({ ...report(), enabled: mode !== 'disabled', fresh: mode !== 'stale' })
    mount()
    expect(await screen.findByRole('button', { name: 'Обработать однозначные (1)' })).toBeDisabled()
    expect(syncApi.applyNotionFieldReport).not.toHaveBeenCalled()
  })
})
