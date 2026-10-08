import React, { useState } from 'react'
import { authApi } from '@/api/auth'

type Phase = 'form' | 'sent' | 'unavailable'

interface Props {
  /** Почта из формы входа — чтобы не вводить второй раз. */
  initialEmail?: string
}

/**
 * «Забыли пароль?» — ссылка на почту аккаунта и на привязанный Gmail.
 *
 * Ответ сервера одинаковый, есть такая почта или нет, поэтому и экран после
 * отправки один. Главное на нём — подсказка про «Спам»: письма с нового
 * адреса Gmail и Mail.ru часто кладут туда, и без подсказки человек решает,
 * что ничего не пришло.
 */
export const ForgotPasswordForm: React.FC<Props> = ({ initialEmail = '' }) => {
  const [email, setEmail] = useState(initialEmail)
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      await authApi.requestPasswordReset(email.trim())
      setPhase('sent')
    } catch (err: unknown) {
      const res = (err as {
        response?: { status?: number; headers?: Record<string, string>; data?: { detail?: string } }
      }).response
      if (res?.headers?.['x-error-code'] === 'MAIL_NOT_CONFIGURED') {
        setPhase('unavailable')
      } else if (res?.status === 429) {
        setError('Слишком много запросов. Подождите немного — ссылка, скорее всего, уже в почте.')
      } else {
        setError(res?.data?.detail || 'Не удалось отправить ссылку. Попробуйте позже.')
      }
    } finally {
      setSending(false)
    }
  }

  if (phase === 'unavailable') {
    return (
      <p className="mx-auto mt-3 max-w-[320px] text-[13px] leading-relaxed text-white/55">
        Напишите своему ментору или МЗК-менеджеру — они пришлют ссылку, по которой вы
        зададите новый пароль.
      </p>
    )
  }

  if (phase === 'sent') {
    return (
      <div
        role="status"
        className="mt-4 rounded-ctl border border-[#FFD400]/25 bg-[#FFD400]/[0.08] px-4 py-4 text-left text-sm leading-6 text-white/80"
      >
        <p className="font-semibold text-white">Проверьте почту</p>
        <p className="mt-1">
          Если <span className="font-semibold text-white">{email.trim()}</span> есть в системе, мы
          отправили на неё ссылку для нового пароля. Если к аккаунту привязан Gmail, письмо придёт
          и туда.
        </p>
        <p className="mt-3 font-semibold text-white">Не видите письма?</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            Загляните в папки <b>«Спам»</b> и <b>«Промоакции»</b> — письмо от TeenTechEd могло
            попасть туда. Отметьте его «Не спам».
          </li>
          <li>Ссылка действует 2 часа и открывается один раз.</li>
          <li>Не пришло за 5 минут — напишите ментору или МЗК-менеджеру.</li>
        </ul>
        <button
          type="button"
          onClick={() => setPhase('form')}
          className="mt-3 text-[13px] font-bold text-white/70 underline decoration-white/25 underline-offset-4 hover:text-white"
        >
          Отправить ещё раз
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto mt-4 max-w-[340px] space-y-3 text-left">
      <p className="text-[13px] leading-relaxed text-white/55">
        Введите почту, которую указывали при регистрации, или привязанный Gmail — пришлём ссылку
        для нового пароля.
      </p>
      {error && (
        <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}
      <label className="sr-only" htmlFor="reset-email">
        Почта
      </label>
      <input
        id="reset-email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@gmail.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-11 w-full rounded-ctl border px-4 text-sm transition-colors"
      />
      <button
        type="submit"
        disabled={sending}
        className="auth-primary-button h-11 w-full text-[12px] uppercase tracking-[0.14em]"
      >
        {sending ? 'Отправляем…' : 'Прислать ссылку'}
      </button>
    </form>
  )
}
