import React, { useEffect, useRef, useState } from 'react'
import { ADMIN_TOKENS, type AdminColorPrefix } from '@/components/admin/tokens'
import { toDateKey } from '@/components/workspace/tasks/workItems'
import { cn } from '@/lib/utils'

/** Порядок пунктов как в списке: от ближних сроков к «вручную». */
const PRESETS = [
  { key: 'today', label: 'Сегодня', days: 0 },
  { key: 'tomorrow', label: 'Завтра', days: 1 },
  { key: 'in3', label: 'Через 3 дня', days: 3 },
  { key: 'week', label: 'Через неделю', days: 7 },
  { key: 'two-weeks', label: 'Через 2 недели', days: 14 },
] as const

const NONE = 'none'
const MANUAL = 'manual'

function inDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

const LONG = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

export function describeDue(value: string): string {
  const [y, m, d] = value.split('-').map(Number)
  return LONG.format(new Date(y, (m ?? 1) - 1, d ?? 1))
}

/** Какой пункт списка соответствует уже выставленной дате: готовый срок или «вручную». */
function selectionFor(value: string): string {
  if (!value) return NONE
  const preset = PRESETS.find((item) => inDays(item.days) === value)
  return preset ? preset.key : MANUAL
}

/**
 * Срок выпадающим списком: готовые варианты, «Без срока» и «Вручную» — последний
 * открывает обычный календарь. Так самый частый выбор делается одним кликом, а
 * произвольная дата никуда не делась.
 */
export const DueField: React.FC<{
  colorPrefix: AdminColorPrefix
  value: string
  onChange: (value: string) => void
}> = ({ colorPrefix, value, onChange }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [selection, setSelection] = useState(() => selectionFor(value))
  const dateRef = useRef<HTMLInputElement>(null)

  // Дату могли сбросить снаружи (смена режима формы): список возвращается в «Без срока».
  useEffect(() => {
    if (!value && selection !== MANUAL) setSelection(NONE)
  }, [value, selection])

  const choose = (key: string) => {
    setSelection(key)
    if (key === NONE) return onChange('')
    if (key === MANUAL) {
      // Календарь открывается сразу — иначе «Вручную» выглядело бы как пустое действие.
      requestAnimationFrame(() => {
        dateRef.current?.focus()
        try {
          dateRef.current?.showPicker?.()
        } catch {
          // showPicker требует жеста пользователя и не везде доступен — поле всё равно в фокусе
        }
      })
      return
    }
    const preset = PRESETS.find((item) => item.key === key)
    if (preset) onChange(inDays(preset.days))
  }

  const field = cn('h-11 rounded-ctl border px-3 text-sm font-bold outline-none focus:border-current', t.borderLine, t.panel2, t.ink)

  return (
    <div className="space-y-2">
      <select value={selection} onChange={(event) => choose(event.target.value)} aria-label="Срок" className={cn(field, 'w-full')}>
        {PRESETS.map((item) => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
        <option value={NONE}>Без срока</option>
        <option value={MANUAL}>Вручную…</option>
      </select>

      {selection === MANUAL && (
        <input
          ref={dateRef}
          type="date"
          value={value}
          min={toDateKey(new Date())}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Дата срока"
          className={cn(field, 'w-full sm:w-auto')}
        />
      )}

      {value && (
        <p className={cn('text-xs', t.muted)}>
          {describeDue(value)}
        </p>
      )}
    </div>
  )
}
