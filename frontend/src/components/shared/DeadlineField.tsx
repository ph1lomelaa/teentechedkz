import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatDeadline, isLaterThanTask } from '@/lib/roadmapDeadline'

interface DeadlineFieldProps {
  dueDate: string | null
  /** Просрочка в днях; 0 — не просрочено или выполнено. */
  overdueDays: number
  /** Срок основной задачи — для предупреждения «позже срока задачи» у подзадачи. */
  taskDueDate?: string | null
  /** Если передан — сотрудник может менять срок; иначе только просмотр. */
  onChange?: (dueDate: string | null) => void
  label: string
  /** Цвета оболочки: p-* (CRM/портал) или w-* (кабинет). */
  tone?: 'p' | 'w'
  /** «+ срок» проявляется при наведении на строку (у подзадач, чтобы не шуметь). */
  subtle?: boolean
  className?: string
}

/** Срок в одной строке: «до 15 окт.», «+ срок», «просрочено на N дн.», «позже срока задачи». */
export const DeadlineField: React.FC<DeadlineFieldProps> = ({
  dueDate, overdueDays, taskDueDate, onChange, label, tone = 'p', subtle = false, className,
}) => {
  const [picking, setPicking] = useState(false)
  const overdue = overdueDays > 0
  const later = isLaterThanTask(dueDate, taskDueDate ?? null)
  const muted = tone === 'w' ? 'text-w-muted' : 'text-p-muted'
  const line = tone === 'w' ? 'border-w-line bg-w-panel' : 'border-p-line bg-p-bg'

  if (!dueDate && !onChange) return null

  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px]', className)} data-overdue={overdue || undefined}>
      {overdue && (
        <span className="font-bold text-ds-danger" data-testid="overdue-badge">просрочено на {overdueDays} дн.</span>
      )}
      {later && (
        <span className="font-medium text-amber-500" data-testid="later-warning">позже срока задачи</span>
      )}
      {onChange ? (
        dueDate || picking ? (
          <input
            type="date"
            autoFocus={picking && !dueDate}
            value={dueDate ?? ''}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(e) => { onChange(e.target.value || null); setPicking(false) }}
            onBlur={() => setPicking(false)}
            aria-label={label}
            className={cn('h-7 rounded-full border px-3 tabular-nums', line, overdue ? 'border-ds-danger/60 text-ds-danger' : muted)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className={cn('font-medium hover:underline', muted, subtle && 'sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:focus-visible:opacity-100')}
            aria-label={label}
          >
            + срок
          </button>
        )
      ) : (
        <span className={cn('tabular-nums', overdue ? 'text-ds-danger' : muted)}>до {formatDeadline(dueDate!)}</span>
      )}
    </div>
  )
}
