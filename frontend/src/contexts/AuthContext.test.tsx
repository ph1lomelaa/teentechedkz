import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../types'

/**
 * `can()` — единственная проверка прав на фронте (Этап 2.4).
 *
 * Ради чего тест: `canAccess`, которую она заменила, возвращала `true` кому
 * угодно в четырёх ветках из шести — включая опекунов (ИИН родителей) и
 * конфиденциальные заметки. Сломалась она молча, потому что на неё не было ни
 * одного теста: она всегда что-то возвращала, и это «что-то» выглядело
 * правдоподобно.
 *
 * Поэтому проверяется главное свойство: `can()` отвечает ТОЛЬКО по списку,
 * пришедшему с сервера, и при его отсутствии закрывает доступ, а не открывает.
 */
const me = vi.fn()

vi.mock('../api/auth', () => ({
  authApi: {
    me: () => me(),
    refresh: async () => ({ access_token: 'token', token_type: 'bearer', expires_in: 900 }),
    login: vi.fn(),
    logout: vi.fn(),
  },
}))
vi.mock('../api/client', () => ({
  setAccessToken: vi.fn(),
  setForbiddenHandler: vi.fn(),
}))
vi.mock('../lib/ws', () => ({ ws: { start: vi.fn(), stop: vi.fn() } }))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { can, user } = useAuth()
  if (!user) return <div>нет сессии</div>
  return (
    <ul>
      <li>guardians:manage={String(can('guardians', 'manage'))}</li>
      <li>finances:view={String(can('finances', 'view'))}</li>
      <li>finances:manage={String(can('finances', 'manage'))}</li>
      <li>выдуманное={String(can('made_up', 'manage'))}</li>
    </ul>
  )
}

function renderWithUser(user: Partial<User>) {
  me.mockResolvedValue({
    id: 'u1',
    name: 'Ментор',
    email: 'm@e.kz',
    role: 'mentor',
    is_active: true,
    must_change_password: false,
    ...user,
  })
  render(
    <MemoryRouter>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('AuthContext.can', () => {
  beforeEach(() => me.mockReset())

  it('отвечает по списку, пришедшему с сервера', async () => {
    renderWithUser({ permissions: ['guardians:manage', 'finances:view'] })
    expect(await screen.findByText('guardians:manage=true')).toBeInTheDocument()
    expect(screen.getByText('finances:view=true')).toBeInTheDocument()
  })

  it('не додумывает права, которых в списке нет', async () => {
    // finances:view есть, finances:manage — нет. Ровно та разница, на которой
    // ломалась canAccess: она отвечала за весь ресурс сразу.
    renderWithUser({ permissions: ['guardians:manage', 'finances:view'] })
    expect(await screen.findByText('finances:manage=false')).toBeInTheDocument()
  })

  it('закрывает неизвестный ресурс', async () => {
    renderWithUser({ permissions: ['guardians:manage'] })
    expect(await screen.findByText('выдуманное=false')).toBeInTheDocument()
  })

  it('без прав в payload закрывает всё, а не открывает', async () => {
    // Бэкенд старее фронта — единственный способ получить пользователя без
    // permissions. Отказ безопаснее, чем молчаливое «раз не знаю, значит можно».
    renderWithUser({ permissions: undefined })
    expect(await screen.findByText('guardians:manage=false')).toBeInTheDocument()
  })

  it('canAccess больше не существует', async () => {
    // Удалять сломанное надо так, чтобы оно не вернулось «по привычке».
    const contextModule = await import('./AuthContext')
    renderWithUser({ permissions: [] })
    await waitFor(() => expect(screen.getByText('guardians:manage=false')).toBeInTheDocument())
    expect(Object.keys(contextModule)).not.toContain('canAccess')
  })
})
