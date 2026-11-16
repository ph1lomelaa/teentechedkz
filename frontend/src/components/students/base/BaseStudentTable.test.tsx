import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { StudentListItem } from '@/types'
import { BaseStudentTable } from './BaseStudentTable'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => false, hasRole: () => false, user: { id: 'u', role: 'mzk_manager' } }) }))

const student = (id: string, name: string, extra: Partial<StudentListItem> = {}) =>
  ({ id, full_name: name, degree_level: 'undergraduate', intake_year: 2027, responsibles: [], ...extra }) as unknown as StudentListItem

function renderTable(showOffer: boolean) {
  const rows = [
    student('1', 'Томирис Серикова', { offers: [{ university: 'Seoul National University', country: 'Южная Корея', status: 'offer_received' }], offer_date: '2026-11-16' }),
    student('2', 'Без Оффера'),
  ]
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><BaseStudentTable groups={[['Все', rows]]} selectedIds={new Set()} onToggle={() => {}} onSelectAll={() => {}}
    onOpen={() => {}} onRole={() => {}} onSelf={() => {}} canAssign={false} isManager={false} intakeOverview={{}} sortAscending onSort={() => {}}
    isLoading={false} onRetry={() => {}} selfPending={false} showCountries={false} showOffer={showOffer} showForms={false}
    notionStatuses={new Map()} notionStatusColors={new Map()} showSelection={false} /></MemoryRouter></QueryClientProvider>)
}

describe('колонка «Оффер» в «Общей базе»', () => {
  it('показывает вуз и дату оффера', () => {
    renderTable(true)
    expect(screen.getByRole('columnheader', { name: 'Оффер' })).toBeInTheDocument()
    expect(screen.getByText('Seoul National University')).toBeInTheDocument()
    expect(screen.getByText('16.11.2026')).toBeInTheDocument()
  })
  it('скрывается, если столбец выключен', () => {
    renderTable(false)
    expect(screen.queryByRole('columnheader', { name: 'Оффер' })).toBeNull()
  })
})
