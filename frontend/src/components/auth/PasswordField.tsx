import React, { useState } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export const MIN_PASSWORD_LENGTH = 8

/**
 * Поле пароля для экранов входа и смены пароля: «показать», предупреждение
 * о Caps Lock. Ошибка «неверный пароль» чаще всего — включённый Caps Lock или
 * опечатка, которую не видно за точками.
 */
export const PasswordField: React.FC<{
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
  invalid?: boolean
  describedBy?: string
}> = ({ id, label, value, onChange, autoComplete, placeholder, invalid, describedBy }) => {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  const trackCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'))
  }

  return (
    <div className="space-y-2">
      <label className="auth-field-label block" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={trackCaps}
          onKeyDown={trackCaps}
          onBlur={() => setCapsLock(false)}
          required
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          spellCheck={false}
          autoCapitalize="none"
          className={cn(
            'h-12 w-full rounded-ctl border pl-4 pr-12 text-sm transition-colors',
            invalid && '!border-red-400/60',
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD400]"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {capsLock && (
        <p className="text-xs font-semibold text-[#FFD400]" role="status">
          Включён Caps Lock
        </p>
      )}
    </div>
  )
}

export interface PasswordCheck {
  key: string
  label: string
  ok: boolean
}

/** Требования к новому паролю — те же, что проверяет сервер (минимум 8 символов). */
export function newPasswordChecks(next: string, confirm: string): PasswordCheck[] {
  return [
    { key: 'length', label: `Не короче ${MIN_PASSWORD_LENGTH} символов`, ok: next.length >= MIN_PASSWORD_LENGTH },
    { key: 'mix', label: 'Есть буквы и цифры', ok: /\p{L}/u.test(next) && /\d/.test(next) },
    { key: 'match', label: 'Пароли совпадают', ok: next.length > 0 && next === confirm },
  ]
}

/** Обязательные проверки блокируют сохранение; «буквы и цифры» — совет. */
export function newPasswordReady(next: string, confirm: string): boolean {
  return next.length >= MIN_PASSWORD_LENGTH && next === confirm
}

/** Живой чек-лист под полями нового пароля. */
export const PasswordChecklist: React.FC<{ id?: string; next: string; confirm: string }> = ({ id, next, confirm }) => (
  <ul id={id} className="grid gap-1.5 text-[13px]" aria-live="polite">
    {newPasswordChecks(next, confirm).map((check) => (
      <li key={check.key} className={cn('flex items-center gap-2 transition-colors', check.ok ? 'text-emerald-400' : 'text-white/45')}>
        <span
          className={cn(
            'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
            check.ok ? 'border-emerald-400 bg-emerald-400/15' : 'border-white/25',
          )}
          aria-hidden="true"
        >
          {check.ok && <Check className="h-3 w-3" />}
        </span>
        <span>
          {check.label}
          {check.key === 'mix' && !check.ok && <span className="text-white/30"> — желательно</span>}
          <span className="sr-only">{check.ok ? ' — выполнено' : ' — не выполнено'}</span>
        </span>
      </li>
    ))}
  </ul>
)
