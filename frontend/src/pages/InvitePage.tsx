import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { inviteApi, type InviteInfo } from '@/api/invite'
import { AuthShell } from '@/components/auth/AuthShell'
import { useAuth } from '@/contexts/AuthContext'
import { getDefaultPath } from '@/lib/authRouting'
import { PasswordChecklist, PasswordField, newPasswordReady } from '@/components/auth/PasswordField'

/**
 * Публичная страница приёма приглашения: /invite/:token
 * Ученик переходит по одноразовой ссылке, подтверждает и задаёт постоянный
 * пароль. Приём сразу логинит его — дальше вход вручную не нужен.
 */
export const InvitePage: React.FC = () => {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { setSession } = useAuth()
  // ?reset=1 — пришли из письма «Забыли пароль?»: та же ссылка, другие слова.
  const [params] = useSearchParams()
  const isReset = params.get('reset') === '1'

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
      const result = await inviteApi.accept(token, next)
      setSession(result.user, result.access_token)
      setDone(true)
      navigate(getDefaultPath(result.user.role), { replace: true })
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

  const title = checking
    ? 'Проверяем приглашение…'
    : done
      ? 'Доступ готов'
      : info?.valid
        ? isReset
          ? 'Новый пароль'
          : 'Задайте пароль'
        : 'Ссылка недействительна'

  const description = checking
    ? 'Это займёт всего несколько секунд.'
    : done
      ? 'Пароль установлен. Открываем ваш кабинет…'
      : info?.valid
        ? `${info.name ? `${info.name}, ` : ''}придумайте ${isReset ? 'новый' : 'постоянный'} пароль для входа${info.email ? ` — ${info.email}` : ''}.`
        : isReset
          ? 'Ссылка устарела или уже использована. Запросите новую: «Забыли пароль?» на странице входа.'
          : 'Ссылка устарела или уже использована. Попросите менеджера прислать новую.'

  return (
    <AuthShell eyebrow={isReset ? 'Восстановление доступа' : 'Активация аккаунта'} title={title} description={description}>
        {checking ? null : done ? (
          <div className="text-center text-sm text-white/45">Открываем кабинет…</div>
        ) : info?.valid ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

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
              label="Повторите пароль"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={confirm.length > 0 && confirm !== next}
              describedBy="password-rules"
            />
            <PasswordChecklist id="password-rules" next={next} confirm={confirm} />

            <button
              type="submit"
              disabled={submitting || !newPasswordReady(next, confirm)}
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
