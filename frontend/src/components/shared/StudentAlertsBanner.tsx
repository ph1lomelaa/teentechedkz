import type { StudentAlert } from '@/types'

/**
 * Баннер финансовых предупреждений вверху карточки студента:
 * просрочка/скорая оплата клиента, невыплата ментору. Данные приходят из
 * GET /students/{id} (поле alerts), считаются на бэке (contract_finance).
 */

const TONE: Record<StudentAlert['level'], string> = {
  danger: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200',
}

const ICON: Record<StudentAlert['level'], string> = { danger: '⚠️', warning: '⏰', info: 'ℹ️' }

function money(amount: number | null, currency: string): string {
  if (amount == null) return ''
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(amount))} ${currency}`
}

export function StudentAlertsBanner({ alerts }: { alerts?: StudentAlert[] }) {
  if (!alerts || alerts.length === 0) return null
  return (
    <div className="mb-4 space-y-2">
      {alerts.map((a, i) => (
        <div
          key={`${a.kind}-${i}`}
          className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium ${TONE[a.level]}`}
        >
          <span aria-hidden>{ICON[a.level]}</span>
          <span className="flex-1">
            {a.title}
            {a.amount != null && <span className="font-bold"> — {money(a.amount, a.currency)}</span>}
          </span>
          {a.due_date && (
            <span className="whitespace-nowrap text-xs opacity-80">
              срок {new Date(a.due_date).toLocaleDateString('ru-RU')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
