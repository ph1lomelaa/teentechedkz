// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MyStudentsPage } from './MyStudentsPage'

const list = vi.hoisted(() => vi.fn())
vi.mock('@/api/students', () => ({ studentsApi: { list } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', role: 'mzk_manager' } }) }))

const st = (id: string, full_name: string, intake_year: number, extra: object = {}) => ({
  id, full_name, intake_year, degree_level: 'bachelor', pipeline_status: 'active_work', countries: [{ country: 'США', is_primary: true }],
  responsibles: [{ id: 'me', role: 'mzk', is_active: true }], services_summary: { items: [] }, ...extra,
})

beforeEach(() => {
  localStorage.clear()
  list.mockResolvedValue({ items: [
    st('a', 'Анна', 2026),
    st('b', 'Борис', 2027, { pipeline_status: 'paused', countries: [{ country: 'Корея', is_primary: true }], responsibles: [{ id: 'me', role: 'lead', is_active: true }] }),
    st('c', 'Вера', 2027),
  ], total: 3 })
})
afterEach(cleanup)

const show = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><MyStudentsPage /></MemoryRouter></QueryClientProvider>)

it('таблица сгруппирована по наборам, фильтры слева со счётчиками', async () => {
  show()
  expect(await screen.findByRole('button', { name: /Набор 2026 · 1/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Набор 2027 · 2/ })).toBeTruthy()
  const panel = within(screen.getByLabelText('Фильтры студентов'))
  fireEvent.click(panel.getByLabelText(/Корея/))
  await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Анна' })).toHaveLength(0))
  expect(screen.getAllByRole('link', { name: 'Борис' }).length).toBeGreaterThan(0)
  fireEvent.click(panel.getByRole('button', { name: /Сбросить фильтры/ }))
  fireEvent.click(panel.getByLabelText(/Ментор по УП/))
  await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Вера' })).toHaveLength(0))
})

it('нет совпадений — подсказка про фильтры', async () => {
  show()
  const panel = within(await screen.findByLabelText('Фильтры студентов'))
  fireEvent.change(panel.getByLabelText('Поиск студентов'), { target: { value: 'никого' } })
  expect(await screen.findByText(/Под выбранные фильтры никто не подходит/)).toBeTruthy()
})
