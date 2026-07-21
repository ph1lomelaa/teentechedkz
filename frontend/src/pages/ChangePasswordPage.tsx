import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { authApi } from '@/api/auth'
import { AuthShell } from '@/components/auth/AuthShell'

/**
 * Смена пароля. Обязательна при первом входе (must_change_password) —
 * студент входит по временному паролю и задаёт свой.
 */
export const ChangePasswordPage: React.FC = () => {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const forced = !!user?.must_change_password

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (next.length < 8) {
      setError('Новый пароль должен быть минимум 8 символов')
      return
    }
    if (next !== confirm) {
      setError('Пароли не совпадают')
      return
    }
    setLoading(true)
    try {
      await authApi.changePassword(current, next)
      await refreshUser()
      const destination = user?.role === 'student'
        ? '/portal'
        : user?.role === 'admin' || user?.role === 'mzk_manager'
          ? '/dashboard'
          : '/workspace'
      navigate(destination, { replace: true })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(detail || 'Не удалось сменить пароль')
    } finally {
      setLoading(false)
    }
  }

  const inputCls =
    'h-12 w-full rounded-[10px] border px-4 text-sm transition-colors'

  return (
    <AuthShell
      eyebrow="Безопасность"
      title={forced ? 'Задайте новый пароль' : 'Смена пароля'}
      description={forced ? 'Это первый вход. Замените временный пароль на свой, чтобы продолжить.' : 'Используйте не менее 8 символов и не повторяйте старый пароль.'}
    >
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-[10px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="auth-field-label block" htmlFor="current">
              {forced ? 'Временный пароль' : 'Текущий пароль'}
            </label>
            <input
              id="current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
              className={inputCls}
            />
          </div>

          <div className="space-y-2">
            <label className="auth-field-label block" htmlFor="next">
              Новый пароль
            </label>
            <input
              id="next"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              autoComplete="new-password"
              className={inputCls}
            />
          </div>

          <div className="space-y-2">
            <label className="auth-field-label block" htmlFor="confirm">
              Повторите новый пароль
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className={inputCls}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="auth-primary-button h-12 w-full text-[13px] uppercase tracking-[0.14em]"
          >
            {loading ? 'Сохраняем…' : 'Сохранить пароль'}
          </button>
        </form>
    </AuthShell>
  )
}
