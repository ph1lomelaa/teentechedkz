// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { actsApi, type ActRecord } from '@/api/acts'
import { ActMailDialog } from './ActMailDialog'
vi.mock('@/api/acts', () => ({ actsApi: { pdf: vi.fn(), send: vi.fn() } }))
afterEach(cleanup)

it('shows the attached act PDF next to the letter before sending', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:act'); URL.revokeObjectURL = vi.fn()
  vi.mocked(actsApi.pdf).mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
  const act = { id: 'act', file_name: 'Акт.pdf', student_name: 'Жолдас Нурай', snapshot: { customer_email: 'parent@example.com' } } as unknown as ActRecord
  render(<QueryClientProvider client={new QueryClient()}><ActMailDialog act={act} recipients={[]} onClose={() => {}} onSent={() => {}} /></QueryClientProvider>)
  expect(await screen.findByTitle('Предпросмотр акта PDF')).toHaveAttribute('src', 'blob:act')
  expect(actsApi.pdf).toHaveBeenCalledWith('act')
  expect(screen.getAllByText(/Предпросмотр/).length).toBeGreaterThan(0)
})
