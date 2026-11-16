// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Application } from '@/types'
import { ApplicationsSection } from './ApplicationsSection'

const apps = vi.hoisted(() => ({ listForStudent: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), listMine: vi.fn() }))
const creds = vi.hoisted(() => ({ listForStudent: vi.fn(), create: vi.fn() }))
vi.mock('@/api', () => ({
  applicationsApi: apps,
  countriesApi: { list: vi.fn().mockResolvedValue([{ id: 'nl', country_name: 'Нидерланды', flag_emoji: '' }]) },
}))
vi.mock('@/api/universities', () => ({ universitiesApi: { list: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/credentials', async (orig) => ({ ...(await orig<typeof import('@/api/credentials')>()), credentialsApi: creds }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const draft = { id: 'a1', student_id: 's1', country: 'Нидерланды', university: 'TU Delft', submission_status: 'submitted', is_primary: false } as Application

beforeEach(() => {
  vi.clearAllMocks()
  apps.listForStudent.mockResolvedValue([])
  creds.listForStudent.mockResolvedValue([])
  apps.create.mockImplementation(async (values: { submission_status: string }) => {
    if (values.submission_status === 'offer_received') {
      throw { response: { status: 422, data: { detail: 'нет доступа' }, headers: { 'x-error-code': 'PORTAL_CREDENTIALS_REQUIRED' } } }
    }
    return draft
  })
  apps.update.mockResolvedValue({ ...draft, submission_status: 'offer_received' })
  creds.create.mockResolvedValue({ id: 'c1' })
})
afterEach(cleanup)

it('new application with an offer opens the portal access form and sets the offer after it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><ApplicationsSection mode="staff" studentId="s1" /></MemoryRouter></QueryClientProvider>)

  fireEvent.click(await screen.findByText('Добавить заявку'))
  await screen.findByRole('option', { name: 'Нидерланды' })
  fireEvent.change(screen.getByLabelText('Страна'), { target: { value: 'Нидерланды' } })
  fireEvent.change(screen.getByLabelText(/Или впишите вуз вручную/), { target: { value: 'TU Delft' } })
  fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'offer_received' } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

  // Сохранена как «Подано», открыта форма доступа к этой заявке.
  await waitFor(() => expect(apps.create).toHaveBeenLastCalledWith(expect.objectContaining({ submission_status: 'submitted', student_id: 's1' })))
  expect(await screen.findByText('Доступ к порталу вуза')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Портал'), { target: { value: 'Studielink' } })
  fireEvent.change(screen.getByLabelText('Логин'), { target: { value: 'aigerim' } })
  fireEvent.change(screen.getByLabelText(/Пароль/), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

  await waitFor(() => expect(creds.create).toHaveBeenCalledWith(expect.objectContaining({ application_id: 'a1', student_id: 's1' })))
  await waitFor(() => expect(apps.update).toHaveBeenCalledWith('a1', { submission_status: 'offer_received' }))
})
