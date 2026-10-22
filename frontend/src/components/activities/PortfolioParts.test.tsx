import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Participation } from '@/api/activities'
import { FocusNote } from './PortfolioParts'
import { ResultStep } from './ResultStep'

const mocks = vi.hoisted(() => ({ setFocus: vi.fn(), submitResult: vi.fn(), reviewResult: vi.fn() }))
vi.mock('@/api/activities', () => ({ activitiesApi: mocks }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
vi.mock('./PortfolioFiles', () => ({ PortfolioFiles: () => <p>Файлы</p> }))
const wrap = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>)
beforeEach(() => { vi.clearAllMocks(); mocks.setFocus.mockResolvedValue(null); mocks.submitResult.mockResolvedValue({}); mocks.reviewResult.mockResolvedValue({}) })

it('ученик видит фокус ментора только для чтения, без фокуса блока нет', () => {
  const { container } = wrap(<FocusNote focus={null} />)
  expect(container).toBeEmptyDOMElement()
  wrap(<FocusNote focus={{ text: 'Нужна стажировка', updated_at: '2030-10-01T00:00:00Z', updated_by_name: 'Айгерим' }} />)
  expect(screen.getByText('Нужна стажировка')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Изменить|Задать/ })).toBeNull()
})
it('ментор задаёт фокус на месте', async () => {
  wrap(<FocusNote focus={null} studentId="s1" editable />)
  fireEvent.click(screen.getByRole('button', { name: 'Задать' }))
  fireEvent.change(screen.getByLabelText('Что усилить в портфолио'), { target: { value: 'Олимпиада по математике' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(mocks.setFocus).toHaveBeenCalledWith('s1', 'Олимпиада по математике'))
})

const item = { id: 'p1', decision: 'selected', status: 'in_progress', result_review_status: 'none', result_text: null, result_review_comment: null } as unknown as Participation
it('итог закрыт для ученика, пока обязательные шаги не выполнены', () => {
  wrap(<ResultStep item={item} number={3} own canManage={false} ready={false} />)
  expect(screen.getByText('Откроется, когда обязательные шаги будут выполнены.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Отправить итог ментору' })).toBeNull()
})
it('после шагов ученик отправляет итог, ментор подтверждает его', async () => {
  wrap(<ResultStep item={item} number={3} own canManage={false} ready />)
  fireEvent.change(screen.getByLabelText('Что получилось'), { target: { value: '3 место' } })
  fireEvent.click(screen.getByRole('button', { name: 'Отправить итог ментору' }))
  await waitFor(() => expect(mocks.submitResult).toHaveBeenCalledWith('p1', '3 место'))
  wrap(<ResultStep item={{ ...item, result_review_status: 'pending', result_text: '3 место' }} number={3} own={false} canManage ready />)
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить итог' }))
  await waitFor(() => expect(mocks.reviewResult).toHaveBeenCalledWith('p1', 'approve', ''))
})
