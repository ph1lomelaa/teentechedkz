// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import type { OfferDue } from '@/api/finance'
import { OffersList } from './PaymentLists'

afterEach(cleanup)

const row: OfferDue = {
  contract_id: 'c1', student_id: 's1', student_name: 'Айгерим Офферная', university: 'TU Delft, Нидерланды',
  offers: 2, enrolled: false, offer_at: '2026-11-12T08:00:00+00:00', amount: '1000000', paid: '700000',
  remaining: '300000', remaining_date: null, currency: 'KZT', by_payments: null,
}

it('shows who got an offer and how much is left to close', () => {
  render(
    <MemoryRouter initialEntries={['/finance']}>
      <Routes>
        <Route path="/finance" element={<OffersList rows={[row]} loading={false} error={null} onRetry={() => {}} />} />
        <Route path="/finance/contracts/:id" element={<p>карточка договора</p>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getAllByText('Айгерим Офферная').length).toBeGreaterThan(0)
  expect(screen.getByText(/TU Delft, Нидерланды/)).toBeInTheDocument()
  expect(screen.getByText('+1')).toBeInTheDocument()
  expect(screen.getAllByText(/300\s000/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Открыть договор' }))
  expect(screen.getByText('карточка договора')).toBeInTheDocument()
})

it('warns when Notion remaining is larger than payments say', () => {
  render(
    <MemoryRouter>
      <OffersList rows={[{ ...row, by_payments: '200000' }]} loading={false} error={null} onRetry={() => {}} />
    </MemoryRouter>,
  )
  expect(screen.getByText(/В Notion остаток 300\s000.*по оплатам 200\s000/)).toBeInTheDocument()
})
