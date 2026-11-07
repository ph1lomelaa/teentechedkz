import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NotionScheduleNotice } from './NotionScheduleNotice'
const transfer = vi.hoisted(() => vi.fn())
vi.mock('@/api/finance', () => ({ financeApi: { notionImport: transfer }, financeKeys: { all: ['finance'] } }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); transfer.mockResolvedValue({ created: 315 }) })
function open(count = 315, canManage = true) {
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotionScheduleNotice count={count} canManage={canManage} /></MemoryRouter></QueryClientProvider>)
}
it('explains unscheduled balances without importing on page load', async () => {
 open()
 expect(screen.getByText(/График ещё не заполнен по 315 договорам/)).toBeInTheDocument()
 expect(screen.getByText(/Он не отметит оплату полученной/)).toBeInTheDocument()
 expect(screen.getByRole('link', { name: 'Проверить договоры без графика' })).toHaveAttribute('href', '/finance/contracts?schedule=none')
 expect(transfer).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: 'Создать ожидаемые платежи из Notion' }))
 await waitFor(() => expect(transfer).toHaveBeenCalledTimes(1))
})
it('keeps read-only access read-only', () => {
 open(315, false)
 expect(screen.getByRole('link')).toBeInTheDocument()
 expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
it('does not show a migration notice without eligible contracts', () => {
 open(0)
 expect(screen.queryByText(/График ещё/)).not.toBeInTheDocument()
})
