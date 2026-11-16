// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Application } from '@/types'
import { OfferBlock } from './OfferBlock'

const apps = vi.hoisted(() => ({ listForStudent: vi.fn(), create: vi.fn(), update: vi.fn(), offers: vi.fn() }))
const creds = vi.hoisted(() => ({ listForStudent: vi.fn(), create: vi.fn() }))
vi.mock('@/api', () => ({ applicationsApi: apps }))
vi.mock('@/api/credentials', async (orig) => ({ ...(await orig<typeof import('@/api/credentials')>()), credentialsApi: creds }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const kangwon = { id: 'a1', student_id: 's1', country: 'Южная Корея', university: 'Kangwon National University', submission_status: 'documents_prep', is_primary: false } as Application
const noAccess = { response: { status: 422, data: { detail: 'нет доступа' }, headers: { 'x-error-code': 'PORTAL_CREDENTIALS_REQUIRED' } } }

beforeEach(() => {
  vi.clearAllMocks()
  apps.listForStudent.mockResolvedValue([kangwon])
  apps.offers.mockResolvedValue({ items: [], remaining: '640000', currency: 'KZT', due_date: null, after_offer_days: 5 })
  creds.create.mockResolvedValue({ id: 'c1' })
})
afterEach(cleanup)

const renderBlock = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OfferBlock studentId="s1" /></QueryClientProvider>,
)

it('marks an offer from the card: asks for portal access first, then sets the offer', async () => {
  apps.update.mockRejectedValueOnce(noAccess).mockResolvedValueOnce({ ...kangwon, submission_status: 'offer_received' })
  renderBlock()
  expect(await screen.findByText('Оффера пока нет')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Отметить оффер' }))
  await screen.findByRole('option', { name: /Kangwon National University/ })
  fireEvent.click(screen.getByRole('button', { name: 'Отметить' }))

  expect(await screen.findByText('Доступ к порталу вуза')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Портал'), { target: { value: 'Kangwon' } })
  fireEvent.change(screen.getByLabelText('Логин'), { target: { value: 'yerkenur' } })
  fireEvent.change(screen.getByLabelText(/Пароль/), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

  await waitFor(() => expect(creds.create).toHaveBeenCalledWith(expect.objectContaining({ application_id: 'a1', student_id: 's1' })))
  await waitFor(() => expect(apps.update).toHaveBeenLastCalledWith('a1', { submission_status: 'offer_received' }))
})

it('shows who marked the offer, the remaining amount and the deadline', async () => {
  apps.offers.mockResolvedValue({
    items: [{ application_id: 'a1', university: 'Chonnam National University', country: 'Южная Корея', status: 'offer_received', marked_at: '2026-11-15T16:58:00+00:00', marked_by: 'Зурабова Лана, ментор' }],
    remaining: '640000', currency: 'KZT', due_date: '2026-11-20', after_offer_days: 5,
  })
  renderBlock()
  expect(await screen.findByText('Chonnam National University, Южная Корея')).toBeInTheDocument()
  expect(screen.getByText(/Зурабова Лана, ментор/)).toBeInTheDocument()
  expect(screen.getByText(/Остаток 640\s000 KZT к оплате до 20\.11\.2026/)).toBeInTheDocument()
})

it('adds a university that is not in the applications yet', async () => {
  apps.create.mockResolvedValue({ ...kangwon, id: 'a2', university: 'TU Munich', country: 'Германия', submission_status: 'submitted' })
  apps.update.mockResolvedValue({})
  renderBlock()
  fireEvent.click(await screen.findByRole('button', { name: 'Отметить оффер' }))
  await screen.findByRole('option', { name: /Kangwon/ })
  fireEvent.change(screen.getByLabelText('Вуз'), { target: { value: '__other__' } })
  fireEvent.change(screen.getByLabelText('Название вуза'), { target: { value: 'TU Munich' } })
  fireEvent.change(screen.getByLabelText('Страна'), { target: { value: 'Германия' } })
  fireEvent.click(screen.getByRole('button', { name: 'Отметить' }))
  await waitFor(() => expect(apps.create).toHaveBeenCalledWith(expect.objectContaining({ university: 'TU Munich', country: 'Германия', submission_status: 'submitted' })))
  await waitFor(() => expect(apps.update).toHaveBeenCalledWith('a2', { submission_status: 'offer_received' }))
})
