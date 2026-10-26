import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AccountAccessCard } from './AccountAccessCard'

const mocks = vi.hoisted(() => ({ emails: vi.fn(), config: vi.fn(), link: vi.fn(), unlink: vi.fn(), reset: vi.fn() }))
vi.mock('@/api/auth', () => ({ authApi: { myEmails: mocks.emails, passwordResetConfig: mocks.config, linkGoogle: mocks.link, unlinkEmail: mocks.unlink, requestPasswordReset: mocks.reset } }))
vi.mock('./GoogleSignInButton', () => ({ GoogleSignInButton: ({ onCredential }: { onCredential: (token: string) => void }) => <button onClick={() => onCredential('google-proof')}>Подтвердить Google</button> }))

const initial = { primary: 'primary@corp.test', extras: [], max_extras: 1, google_account: { linked: false, emails: [] } }
function open(prefix: 'p' | 'w' = 'p') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><AccountAccessCard colorPrefix={prefix} /></QueryClientProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.emails.mockResolvedValue(initial)
  mocks.config.mockResolvedValue({ enabled: true })
  mocks.reset.mockResolvedValue({ message: 'sent' })
})

it.each(['p', 'w'] as const)('подтверждение Google доступно ученику и сотруднику (%s)', async (prefix) => {
  mocks.link.mockResolvedValue({ ...initial, google_account: { linked: true, emails: ['primary@corp.test'] } })
  open(prefix)
  fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить Google' }))
  await waitFor(() => expect(mocks.link).toHaveBeenCalledWith('google-proof'))
  expect(await screen.findByText('Google подтверждён: primary@corp.test')).toBeTruthy()
})

it('ссылка восстановления запрашивается только нажатием пользователя', async () => {
  open()
  const button = await screen.findByRole('button', { name: 'Прислать ссылку для нового пароля' })
  await waitFor(() => expect(button).toBeEnabled())
  expect(mocks.reset).not.toHaveBeenCalled()
  fireEvent.click(button)
  await waitFor(() => expect(mocks.reset).toHaveBeenCalledWith('primary@corp.test'))
  expect(await screen.findByText(/Проверьте «Входящие» и «Спам»/)).toBeTruthy()
})

it('без SMTP не обещает отправку и сохраняет Google как доступный путь', async () => {
  mocks.config.mockResolvedValue({ enabled: false })
  open()
  expect(await screen.findByText(/Отправка писем пока не настроена/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Прислать ссылку для нового пароля' })).toBeNull()
  expect(await screen.findByRole('button', { name: 'Подтвердить Google' })).toBeTruthy()
  expect(mocks.reset).not.toHaveBeenCalled()
})

it('ошибка адресов не выглядит как отсутствие привязки', async () => {
  mocks.emails.mockRejectedValue(new Error('Нет связи'))
  open()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText(/Google ещё не подтверждён/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
})

it('отвязка обновляет подтверждение и удаляет старый адрес', async () => {
  mocks.emails.mockResolvedValue({ ...initial, extras: [{ id: 'extra1', email: 'personal@gmail.com', is_verified: true }], google_account: { linked: true, emails: ['personal@gmail.com'] } })
  mocks.unlink.mockResolvedValue(initial)
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Отвязать personal@gmail.com' }))
  await waitFor(() => expect(mocks.unlink).toHaveBeenCalledWith('extra1'))
  expect(await screen.findByText(/Google ещё не подтверждён/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Отвязать personal@gmail.com' })).toBeNull()
})
