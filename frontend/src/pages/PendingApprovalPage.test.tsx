import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { postLoginPath } from '@/lib/authRouting'

/**
 * Экран ожидания и маршрутизация «ворот».
 *
 * Ради чего тест: правка ослабила вход — раньше неактивный аккаунт не получал
 * токена вовсе, теперь получает. Вся защита переехала в гейты, а гейтов трое, и
 * они записаны в трёх местах: `core/deps.py`, `useBaseAuthGuard` и
 * `postLoginPath`. Разойдутся — человек либо провалится мимо экрана ожидания,
 * либо застрянет на нём после одобрения.
 */
const logout = vi.fn()
const refreshUser = vi.fn().mockResolvedValue(undefined)

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Данияр', email: 'd@example.kz', role: 'mentor', is_active: false },
    logout,
    refreshUser,
  }),
}))

// Своя заявка приезжает отдельным запросом; сеть в юнит-тесте не нужна —
// проверяется, что экран её показывает, а не как она доехала.
const mine = vi.fn().mockResolvedValue({
  id: 'r1',
  requested_role: 'student',
  full_name: 'Данияр Сатыбалды',
  phone: '+7 707 123 45 67',
  city: 'Алматы',
  direction: null,
  status: 'new',
  created_at: '2026-09-02T10:00:00Z',
})
vi.mock('@/api/accessRequests', () => ({
  accessRequestsApi: { mine: () => mine() },
}))

const { PendingApprovalPage } = await import('./PendingApprovalPage')

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('postLoginPath', () => {
  const base = { role: 'mentor' as const, is_active: true, must_change_password: false }

  it('ждущего одобрения ведёт на экран ожидания', () => {
    expect(postLoginPath({ ...base, is_active: false })).toBe('/pending')
  })

  it('неоткрытый аккаунт важнее временного пароля', () => {
    // Порядок тот же, что на бэкенде: пока аккаунт не одобрен, менять пароль
    // незачем — этим экраном человека просто не туда уведёт.
    expect(postLoginPath({ ...base, is_active: false, must_change_password: true })).toBe('/pending')
  })

  it('обычного пользователя ведёт домой по роли', () => {
    expect(postLoginPath(base)).toBe('/workspace/my-day')
    expect(postLoginPath({ ...base, role: 'admin' })).toBe('/dashboard')
  })

  it('поле is_active может отсутствовать — это не повод считать аккаунт закрытым', () => {
    // `User.is_active` необязательное: тот же тип описывает пользователя из
    // списка /users. Проверка строго на false, иначе undefined запер бы всех.
    expect(postLoginPath({ role: 'admin', must_change_password: false })).toBe('/dashboard')
  })
})

describe('экран ожидания', () => {
  it('показывает, кем человек вошёл, и статус словом, а не только цветом', () => {
    renderPage(<PendingApprovalPage />)
    expect(screen.getByText('d@example.kz')).toBeInTheDocument()
    expect(screen.getByText('Ожидает подтверждения')).toBeInTheDocument()
  })

  it('даёт перепроверить статус, не выходя', () => {
    renderPage(<PendingApprovalPage />)
    fireEvent.click(screen.getByRole('button', { name: /Проверить статус/ }))
    expect(refreshUser).toHaveBeenCalled()
  })

  it('даёт выйти — иначе экран становится ловушкой', () => {
    renderPage(<PendingApprovalPage />)
    fireEvent.click(screen.getByRole('button', { name: /Выйти/ }))
    expect(logout).toHaveBeenCalled()
  })

  it('показывает данные заявки и даёт их исправить', async () => {
    // «Ждите» без единого признака, что заявка вообще дошла, читается как
    // поломка. Человек должен увидеть свой телефон — по нему его и ищут.
    renderPage(<PendingApprovalPage />)
    expect(await screen.findByText('+7 707 123 45 67')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Изменить данные/ })).toHaveAttribute('href', '/join')
  })
})

describe('порядок ворот в роутере', () => {
  const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf-8')
  const guard = app.slice(app.indexOf('function useBaseAuthGuard'), app.indexOf('function RootRedirect'))

  it('неоткрытый аккаунт проверяется раньше пароля и регламента', () => {
    expect(guard.indexOf('is_active')).toBeGreaterThan(-1)
    expect(guard.indexOf('is_active')).toBeLessThan(guard.indexOf('must_change_password'))
    expect(guard.indexOf('is_active')).toBeLessThan(guard.indexOf('agreement_signature_required'))
  })
})
