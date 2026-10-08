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
  done?: boolean
}

/** Срок в одной строке: «до 15 окт.», «+ срок», «просрочено на N дн.», «позже срока задачи». */
export const DeadlineField: React.FC<DeadlineFieldProps> = ({
  dueDate, overdueDays, taskDueDate, onChange, label, tone = 'p', subtle = false, className, done = false,
}) => {
  const [picking, setPicking] = useState(false)
  const overdue = overdueDays > 0
  const daysLeft = dueDate ? Math.round((new Date(`${dueDate}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)) / 86_400_000) : null
  const soon = !done && !overdue && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3
  const later = isLaterThanTask(dueDate, taskDueDate ?? null)
  const muted = tone === 'w' ? 'text-w-muted' : 'text-p-muted'
  const line = tone === 'w' ? 'border-w-line bg-w-panel' : 'border-p-line bg-p-bg'

  if (!dueDate && !onChange) return null

  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px]', className)} data-overdue={overdue || undefined}>
      {later && (
        <span className="font-medium text-amber-500" data-testid="later-warning">позже срока задачи</span>
      )}
      {onChange ? (
        picking ? (<span className="inline-flex items-center gap-1">
          <input
            type="date"
            autoFocus
            value={dueDate ?? ''}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(e) => { onChange(e.target.value || null); setPicking(false) }}
            onKeyDown={(e) => { if (e.key === 'Escape') setPicking(false) }}
            aria-label={label}
            className={cn('h-7 rounded-full border px-3 tabular-nums', line, overdue ? 'border-ds-danger/60 text-ds-danger' : muted)}
          />
          {dueDate && <button type="button" onClick={() => { onChange(null); setPicking(false) }} className="font-bold text-ds-danger">Убрать срок</button>}
          <button type="button" onClick={() => setPicking(false)} className={muted} aria-label="Закрыть выбор даты">×</button>
        </span>
        ) : (
          <button
            type="button"
            data-testid={overdue ? 'overdue-badge' : undefined}
            onClick={() => setPicking(true)}
            className={cn('rounded-full px-2 py-1 font-medium hover:underline', overdue ? 'bg-ds-danger/10 text-ds-danger' : soon ? 'bg-amber-500/10 text-amber-600' : muted, subtle && !dueDate && 'sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:focus-visible:opacity-100')}
            aria-label={label}
          >
            {overdue ? `просрочено на ${overdueDays} дн.` : soon ? daysLeft === 0 ? 'сегодня' : `через ${daysLeft} дн.` : dueDate ? `до ${formatDeadline(dueDate)}` : '+ срок'}
          </button>
        )
      ) : (
        <span data-testid={overdue ? 'overdue-badge' : undefined} className={cn('rounded-full px-2 py-1 tabular-nums', overdue ? 'bg-ds-danger/10 text-ds-danger' : soon ? 'bg-amber-500/10 text-amber-600' : muted)}>{overdue ? `просрочено на ${overdueDays} дн.` : soon ? daysLeft === 0 ? 'сегодня' : `через ${daysLeft} дн.` : `до ${formatDeadline(dueDate!)}`}</span>
      )}
    </div>
  )
}
