import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { UserRole } from '@/types'

function getDefaultPath(role: UserRole): string {
  switch (role) {
    case 'admin':
    case 'mzk_manager':
      return '/dashboard'
    case 'lead_mentor':
    case 'mentor':
      return '/my-students'
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
      navigate(getDefaultPath(user.role), { replace: true })
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
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white relative overflow-hidden">
      {/* Ghost duplicate text — depth without images */}
      <span
        aria-hidden="true"
        className="absolute top-[8%] -left-[4%] text-[clamp(6rem,18vw,16rem)] leading-none text-white/[0.04] font-black uppercase select-none pointer-events-none whitespace-nowrap"
      >
        Teen Tech ED
      </span>

      {/* Left — brand */}
      <div className="relative flex flex-col justify-between px-8 py-10 lg:px-16 lg:py-14 min-h-[40vh] lg:min-h-screen bg-sidebar">
        <p className="label-caps text-white/65">CRM · Образовательный консалтинг</p>

        <div className="my-10 lg:my-0">
          <h1 className="text-white font-black uppercase leading-[0.95] tracking-tight text-[clamp(2.5rem,7vw,5.5rem)]">
            Teen
            <br />
            Tech ED
          </h1>
          <p className="mt-6 max-w-md text-[clamp(1.05rem,1.6vw,1.35rem)] text-white/70 leading-relaxed">
            Платформа сопровождения студентов — от первого звонка до зачисления.
          </p>
        </div>

        <div className="hidden lg:flex items-center gap-8">
          {['Пайплайн', 'Договоры', 'Менторы', 'Финансы'].map((f) => (
            <span key={f} className="label-caps text-white/55">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div className="relative flex items-center justify-center px-6 py-12 lg:min-h-screen bg-white text-black lg:border-l lg:border-gray-200">
        <div className="w-full max-w-[360px]">
          <div className="mb-10">
            <p className="label-caps text-gray-500 mb-2">Вход</p>
            <h2 className="text-black text-2xl font-semibold tracking-tight">
              Войдите в свой аккаунт
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="border border-red-400/25 bg-red-400/10 text-red-300 text-sm px-4 py-3 rounded-[2px]">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="label-caps text-gray-600 block" htmlFor="email">
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
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-gray-300 rounded-[2px]
                           placeholder:text-gray-400 text-black
                           focus:outline-none focus:border-gray-700 focus:ring-1 focus:ring-gray-400
                           transition-colors duration-150"
              />
            </div>

            <div className="space-y-2">
              <label className="label-caps text-gray-600 block" htmlFor="password">
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
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-gray-300 rounded-[2px]
                           placeholder:text-gray-400 text-black
                           focus:outline-none focus:border-gray-700 focus:ring-1 focus:ring-gray-400
                           transition-colors duration-150"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 text-[13px] font-semibold uppercase tracking-caps rounded-[2px]
                         bg-black text-white hover:bg-black/85
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400
                         transition-colors duration-150
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
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
        </div>
      </div>
    </div>
  )
}
