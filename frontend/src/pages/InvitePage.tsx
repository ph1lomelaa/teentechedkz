import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { inviteApi, type InviteInfo } from '@/api/invite'
import { AuthShell } from '@/components/auth/AuthShell'

/**
 * Публичная страница приёма приглашения: /invite/:token
 * Ученик переходит по одноразовой ссылке, подтверждает и задаёт постоянный
 * пароль. После успеха ссылка сгорает — дальше вход по обычной форме.
 */
export const InvitePage: React.FC = () => {
  const { token = '' } = useParams()
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    inviteApi
      .get(token)
      .then((res) => {
        if (alive) setInfo(res)
      })
      .catch(() => {
        if (alive) setInfo({ valid: false })
      })
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (next.length < 8) {
      setError('Пароль должен быть минимум 8 символов')
      return
    }
    if (next !== confirm) {
      setError('Пароли не совпадают')
      return
    }
    setSubmitting(true)
    try {
      await inviteApi.accept(token, next)
      setDone(true)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      if (status === 410) {
        // Link burned/expired between load and submit — reflect it in the UI.
        setInfo({ valid: false })
      }
      setError(detail || 'Не удалось задать пароль')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'h-12 w-full rounded-ctl border px-4 text-sm transition-colors'

  const title = checking
    ? 'Проверяем приглашение…'
    : done
      ? 'Доступ готов'
      : info?.valid
        ? 'Задайте пароль'
        : 'Ссылка недействительна'

  const description = checking
    ? 'Это займёт всего несколько секунд.'
    : done
      ? 'Пароль установлен. Теперь можно войти в личный кабинет.'
      : info?.valid
        ? `${info.name ? `${info.name}, ` : ''}придумайте постоянный пароль для входа${info.email ? ` — ${info.email}` : ''}.`
        : 'Ссылка устарела или уже использована. Попросите менеджера прислать новую.'

  return (
    <AuthShell eyebrow="Активация аккаунта" title={title} description={description}>
        {checking ? null : done ? (
          <div>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="auth-primary-button h-12 w-full text-[13px] uppercase tracking-[0.14em]"
            >
              Войти в кабинет
            </button>
          </div>
        ) : info?.valid ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

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
                Повторите пароль
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
              disabled={submitting}
              className="auth-primary-button h-12 w-full text-[13px] uppercase tracking-[0.14em]"
            >
              {submitting ? 'Сохраняем…' : 'Сохранить пароль'}
            </button>
          </form>
        ) : (
          <div>
            <Link
              to="/login"
              className="auth-secondary-button h-12 w-full text-[13px] font-bold uppercase tracking-[0.14em]"
            >
              На страницу входа
            </Link>
          </div>
        )}
    </AuthShell>
  )
}
