import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { AuthShell } from '@/components/auth/AuthShell'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { authApi } from '@/api/auth'
import { postLoginPath } from '@/lib/authRouting'

export const LoginPage: React.FC = () => {
  const { login, setSession } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)

  const handleGoogle = async (credential: string) => {
    setError('')
    setIsLoading(true)
    try {
      const data = await authApi.loginWithGoogle(credential)
      setSession(data.user, data.access_token)
      navigate(postLoginPath(data.user), { replace: true })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      // Здесь текст сервера важнее обычного: «Google не подтвердил этот адрес»
      // и «неверный пароль» — разные проблемы с разными действиями.
      if (axiosErr.response?.data?.detail) setError(axiosErr.response.data.detail)
      else setError('Не удалось войти через Google. Попробуйте пароль.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const user = await login(email, password)
      navigate(postLoginPath(user), { replace: true })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      // Backend already distinguishes "wrong password" from "account pending
      // approval" with a specific detail message — don't paper over it with a
      // generic 401 message, or a mentor waiting on approval reads it as
      // their password being wrong.
      if (axiosErr.response?.data?.detail) {
        setError(axiosErr.response.data.detail)
      } else if (axiosErr.response?.status === 401) {
        setError('Неверный email или пароль')
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
              <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
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
                className="h-12 w-full rounded-ctl border px-4 text-sm transition-colors"
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
                className="h-12 w-full rounded-ctl border px-4 text-sm transition-colors"
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

          <GoogleSignInButton onCredential={handleGoogle} onError={setError} />

          {/* Самостоятельного сброса пароля пока нет: единственный путь — сотрудник
              жмёт «сбросить» в карточке студента. Раньше человек об этом нигде не
              узнавал — на форме была только заявка на новый доступ, а настоящий
              ответ лежал в FAQ лендинга. */}
          <div className="mt-7 border-t border-white/10 pt-5 text-center text-sm text-white/45">
            <button
              type="button"
              onClick={() => setShowRecovery((v) => !v)}
              aria-expanded={showRecovery}
              className="font-bold text-white/70 underline decoration-white/25 underline-offset-4 transition hover:text-white hover:decoration-white/60"
            >
              Забыли пароль?
            </button>
            {showRecovery && (
              <p className="mx-auto mt-3 max-w-[320px] text-[13px] leading-relaxed text-white/55">
                Напишите своему ментору или МЗК-менеджеру — они сбросят пароль, и вы
                зададите новый при следующем входе.
              </p>
            )}
            {/* Ведём на /join — регистрацию, а не на /apply. /apply создаёт
                заявку абитуриента (лид) и НЕ создаёт аккаунт: человек её
                отправлял и возвращался на лендинг, потому что входить было
                некуда. С экрана входа стоит тот, у кого доступ должен быть. */}
            <div className="mt-4">
              Ещё нет доступа?{' '}
              <Link to="/join" className="font-bold text-[#FFD400] underline decoration-[#FFD400]/40 underline-offset-4 hover:decoration-[#FFD400]">
                Зарегистрироваться
              </Link>
            </div>
          </div>
    </AuthShell>
  )
}
