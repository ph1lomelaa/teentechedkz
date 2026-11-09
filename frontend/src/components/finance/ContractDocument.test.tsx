// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const contractPdf = vi.fn()
vi.mock('@/api/acts', () => ({ actsApi: { contractPdf: (...a: unknown[]) => contractPdf(...a) } }))
const contractScan = vi.fn()
vi.mock('@/api/finance', () => ({ financeApi: { contractScan: (...a: unknown[]) => contractScan(...a) } }))
const downloadBlob = vi.fn()
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<typeof import('@/lib/utils')>()), downloadBlob: (...a: unknown[]) => downloadBlob(...a) }))

import { ContractDocument } from './ContractDocument'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows every TrustMe contract with open and download buttons', () => {
  render(<ContractDocument studentId="s1" contractId="c1" documents={[{ kind: 'trustme', id: 'a', label: 'Договор №671' }, { kind: 'trustme', id: 'b', label: 'Договор №474' }]} />)
  expect(screen.getByText('Договор №671')).toBeInTheDocument()
  expect(screen.getByText('Договор №474')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Открыть/ })).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: /Скачать/ })).toHaveLength(2)
})

it('downloads the contract PDF under a readable name', async () => {
  const blob = new Blob(['%PDF'])
  contractPdf.mockResolvedValue(blob)
  render(<ContractDocument studentId="s1" contractId="c1" documents={[{ kind: 'trustme', id: 'a', label: 'Договор №671' }]} />)
  fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'Договор №671.pdf'))
  expect(contractPdf).toHaveBeenCalledWith('s1', 'a')
})

it('downloads an uploaded contract scan through the finance route', async () => {
  const blob = new Blob(['%PDF'])
  contractScan.mockResolvedValue(blob)
  render(<ContractDocument studentId="s1" contractId="c1" documents={[{ kind: 'scan', id: 'd1', label: 'Договор Курман.pdf' }]} />)
  expect(screen.getByText('· скан')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'Договор Курман.pdf'))
  expect(contractScan).toHaveBeenCalledWith('c1', 'd1')
  expect(contractPdf).not.toHaveBeenCalled()
})

it('says plainly when no contract file exists', () => {
  render(<ContractDocument studentId="s1" contractId="c1" documents={[]} />)
  expect(screen.getByText('Договор не загружен')).toBeInTheDocument()
})
