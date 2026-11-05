import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoricalDialog, HistoricalExperience } from './HistoricalExperience'
import type { Participation } from '@/api/activities'
const mocks = vi.hoisted(() => ({ saveHistorical: vi.fn(), reviewResult: vi.fn() }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
vi.mock('./PortfolioFiles', () => ({ PortfolioFiles: () => <p>Файлы необязательны</p> }))
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.saveHistorical.mockResolvedValue({ id: 'p1' }); mocks.reviewResult.mockResolvedValue({}) })
function wrap(child: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{child}</QueryClientProvider>) }
it('сохраняет прошлый опыт с годом, без ссылки и файла', async () => {
  const close = vi.fn()
  wrap(<HistoricalDialog studentId="s1" onClose={close} />)
  fireEvent.change(screen.getByLabelText('Название активности'), { target: { value: 'Олимпиада 2024' } })
  fireEvent.change(screen.getByLabelText('Период участия'), { target: { value: '2024' } })
  fireEvent.change(screen.getByLabelText('Результат участия'), { target: { value: 'Финалист' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить и отправить на проверку' }))
  await waitFor(() => expect(mocks.saveHistorical).toHaveBeenCalledWith(expect.objectContaining({ title: 'Олимпиада 2024', period: '2024', result: 'Финалист', source_url: '' }), 's1', undefined))
  expect(close).toHaveBeenCalled()
})
it('прошлый опыт на проверке не предлагает составить план и допускает проверку ментора', async () => {
  const item = { id: 'p1', student_id: 's1', is_historical: true, status: 'completed', result_review_status: 'pending', participation_period: '2024', result_text: 'Финалист', activity: { title: 'Олимпиада', experience_type: 'competitions' } } as Participation
  wrap(<HistoricalExperience item={item} canManage own={false} />)
  expect(screen.getByText('На проверке у ментора')).toBeInTheDocument()
  expect(screen.queryByText('Добавить шаг')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Вернуть на правки' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить итог' }))
  await waitFor(() => expect(mocks.reviewResult).toHaveBeenCalledWith('p1', 'approve', ''))
})
