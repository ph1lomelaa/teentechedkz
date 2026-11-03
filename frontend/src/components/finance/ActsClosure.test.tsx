// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ActsClosure } from './ui'

afterEach(cleanup)

it('shows the TrustMe number and how many services acts have closed', () => {
  render(<ActsClosure row={{ trustme: [{ number: '671' }, { number: '474' }], services_total: 30, services_closed: 2, closed_percent: 7 }} />)
  expect(screen.getByText('№671 +1')).toBeInTheDocument()
  expect(screen.getByText('актами 2 из 30 · 7%')).toBeInTheDocument()
})

it('says plainly when no TrustMe contract is linked', () => {
  render(<ActsClosure row={{ trustme: [], services_total: 0, services_closed: 0, closed_percent: null }} />)
  expect(screen.getByText('Нет договора TrustMe')).toBeInTheDocument()
})
