import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { authApi } from '@/api/auth'
import { AuthShell } from '@/components/auth/AuthShell'
import { getDefaultPath } from '@/lib/authRouting'
import { PasswordChecklist, PasswordField, newPasswordReady } from '@/components/auth/PasswordField'

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
      // Куда вести после смены пароля решает getDefaultPath, а не эта страница:
      // раньше здесь лежала своя копия правила, и она расходилась с логином —
      // ментор попадал то в CRM, то в кабинет, в зависимости от способа входа.
      navigate(getDefaultPath(user!.role), { replace: true })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(detail || 'Не удалось сменить пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Безопасность"
      title={forced ? 'Задайте новый пароль' : 'Смена пароля'}
      description={forced ? 'Это первый вход. Замените временный пароль на свой, чтобы продолжить.' : 'Новый пароль не должен совпадать со старым. После смены другие устройства выйдут из аккаунта.'}
    >
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <PasswordField
            id="current"
            label={forced ? 'Временный пароль' : 'Текущий пароль'}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
          <PasswordField
            id="next"
            label="Новый пароль"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            describedBy="password-rules"
          />
          <PasswordField
            id="confirm"
            label="Повторите новый пароль"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={confirm.length > 0 && confirm !== next}
            describedBy="password-rules"
          />
          <PasswordChecklist id="password-rules" next={next} confirm={confirm} />

          <button
            type="submit"
            disabled={loading || !current || !newPasswordReady(next, confirm)}
            className="auth-primary-button h-12 w-full text-[13px] uppercase tracking-[0.14em]"
          >
            {loading ? 'Сохраняем…' : 'Сохранить пароль'}
          </button>
        </form>
    </AuthShell>
  )
}
