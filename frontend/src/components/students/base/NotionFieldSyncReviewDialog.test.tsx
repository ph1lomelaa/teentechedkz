import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncApi } from '@/api/sync'
import { NotionFieldSyncReviewDialog } from './NotionFieldSyncReviewDialog'

const conflict = {
  id: 'sync-1', student_id: 'student-1', student_name: 'Айгерим', notion_page_id: 'page-1',
  field_key: 'phone', direction: 'conflict', status: 'conflict' as const,
  crm_value: '+77001234567', notion_value: '+77007654321', baseline_value: null,
  has_baseline: false, reason: 'Изменено в обоих источниках', last_error: null, attempts: 0,
  updated_at: null,
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><NotionFieldSyncReviewDialog open onOpenChange={() => {}} /></QueryClientProvider>)
}

describe('сверка полей CRM и Notion', () => {
  beforeEach(() => {
    vi.spyOn(syncApi, 'notionFieldSyncQueue').mockResolvedValue({
      enabled: true, dry_run: true, counts: { conflict: 1 }, items: [conflict],
    })
    vi.spyOn(syncApi, 'resolveNotionFieldConflict').mockResolvedValue({ resolved: true, side: 'crm', queued_item_id: 'sync-2' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('показывает оба значения, но ждёт явного выбора источника', async () => {
    mount()
    expect(await screen.findByText('Айгерим · Телефон')).toBeInTheDocument()
    expect(screen.getByText('+77001234567')).toBeInTheDocument()
    expect(screen.getByText('+77007654321')).toBeInTheDocument()
    expect(syncApi.resolveNotionFieldConflict).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Взять значение CRM' }))
    await waitFor(() => expect(syncApi.resolveNotionFieldConflict).toHaveBeenCalledWith('sync-1', 'crm'))
  })

  it('не отправляет решение, если пользователь отменил подтверждение', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Взять значение Notion' }))
    expect(syncApi.resolveNotionFieldConflict).not.toHaveBeenCalled()
  })
})
