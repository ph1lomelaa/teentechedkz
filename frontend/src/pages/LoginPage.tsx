import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { UserRole } from '@/types'
import { AuthShell } from '@/components/auth/AuthShell'

function getDefaultPath(role: UserRole): string {
  switch (role) {
    case 'admin':
    case 'mzk_manager':
      return '/dashboard'
    case 'mentor':
      return '/my-students'
    case 'student':
      return '/portal'
    default:
      return '/dashboard'
  }
}

export const LoginPage: React.FC = () => {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const user = await login(email, password)
      if (user.must_change_password) {
        navigate('/change-password', { replace: true })
      } else {
        navigate(getDefaultPath(user.role), { replace: true })
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      if (axiosErr.response?.status === 401) {
        setError('Неверный email или пароль')
      } else if (axiosErr.response?.data?.detail) {
        setError(axiosErr.response.data.detail)
      } else {
        setError('Ошибка подключения. Попробуйте позже.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Вход в систему"
      title="Добро пожаловать"
      description="Войдите в кабинет студента, ментора или команды TeenTechEd."
    >
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-[10px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="auth-field-label block" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="admin@teenteched.kz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-12 w-full rounded-[10px] border px-4 text-sm transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="auth-field-label block" htmlFor="password">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-12 w-full rounded-[10px] border px-4 text-sm transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="auth-primary-button h-12 w-full text-[13px] uppercase tracking-[0.14em]"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin text-black" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Входим…
                </span>
              ) : (
                'Войти →'
              )}
            </button>
          </form>

          <div className="mt-7 border-t border-white/10 pt-5 text-center text-sm text-white/45">
            Нет доступа?{' '}
            <Link to="/apply" className="font-bold text-[#FFD400] underline decoration-[#FFD400]/40 underline-offset-4 hover:decoration-[#FFD400]">
              Оставить заявку
            </Link>
          </div>
    </AuthShell>
  )
}
