// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ setSession: vi.fn() }) }))
vi.mock('@/api/auth', () => ({ authApi: { googleConfig: async () => ({ enabled: true }) } }))
const join = vi.fn()
vi.mock('@/api/public', () => ({ publicApi: { join: (...a: unknown[]) => join(...a) } }))
// Google-кнопка сразу «подтверждает» почту токеном с email внутри.
const token = `x.${btoa(JSON.stringify({ email: 'fin@gmail.com' }))}.y`
vi.mock('@/components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (v: string) => void }) =>
    <button type="button" onClick={() => onCredential(token)}>Google</button>,
}))

import { JoinPage } from './JoinPage'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderPage() {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><JoinPage /></MemoryRouter></QueryClientProvider>)
}

it('сотрудник выбирает «Финансист», почта для писем обязательна и подставлена из Google', async () => {
  renderPage()
  expect(screen.getByText('Я ученик')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Я сотрудник'))
  expect(screen.getByText('Ментор')).toBeInTheDocument()
  expect(screen.getByText('МЗК')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Финансист'))
  fireEvent.click(await screen.findByText('Google'))
  expect(screen.getByText('Регистрация финансиста')).toBeInTheDocument()
  const mail = screen.getByDisplayValue('fin@gmail.com')
  // Код приглашения финансисту не показываем.
  expect(screen.queryByText(/Код приглашения/)).toBeNull()

  fireEvent.change(mail, { target: { value: '' } })
  fireEvent.change(document.querySelector('input[autocomplete="name"]')!, { target: { value: 'Финансист Тест' } })
  fireEvent.change(document.querySelector('input[type="tel"]')!, { target: { value: '+7 707 123 45 67' } })
  fireEvent.click(screen.getByRole('button', { name: /Продолжить/ }))
  expect(await screen.findByText(/Укажите почту/)).toBeInTheDocument()
  expect(join).not.toHaveBeenCalled()

  fireEvent.change(mail, { target: { value: 'buh@teenteched.kz' } })
  join.mockResolvedValue({ status: 'pending', user: {}, access_token: 't' })
  fireEvent.click(screen.getByRole('button', { name: /Продолжить/ }))
  await vi.waitFor(() => expect(join).toHaveBeenCalled())
  expect(join.mock.calls[0][0]).toMatchObject({ requested_role: 'finance_manager', contact_email: 'buh@teenteched.kz' })
})
