import { RefreshCw } from 'lucide-react'
import type { NotionStatusInfo } from '@/api/notion'
import { cn } from '@/lib/utils'
import { notionTagClass } from '@/lib/notionColors'
import { formatSyncTime, syncHealth, SYNC_STALE_AFTER_HOURS } from './viewState'

const DOT: Record<ReturnType<typeof syncHealth>, string> = {
  ok: 'bg-p-good',
  stale: 'bg-st-check',
  error: 'bg-p-danger',
  unknown: 'bg-p-muted2',
}

const HEALTH_TEXT: Record<ReturnType<typeof syncHealth>, string> = {
  ok: 'Синхронизация в порядке',
  stale: `Данные старше ${SYNC_STALE_AFTER_HOURS} ч`,
  error: 'Последняя синхронизация не удалась',
  unknown: 'Синхронизации ещё не было',
}

/**
 * Строка состояния вместо кнопки «Синк Notion»: точка-индикатор, число
 * записей, время обновления и иконка, запускающая ту же синхронизацию.
 */
export function SyncStatusLine({ status, total, pending, onSync }: {
  status?: NotionStatusInfo
  total: number
  pending: boolean
  /** Не передан — у пользователя нет права запускать синхронизацию. */
  onSync?: () => void
}) {
  const health = syncHealth(status?.last_run)
  const at = status?.last_run?.at
  return (
    <div className="text-sm text-p-muted">
      {/* Одним абзацем, а не флексом: на узком экране переносится только текст,
          точка и кнопка остаются при нём, а не уезжают на отдельные строки. */}
      <p>
        <span className={cn('mr-2 inline-block h-2 w-2 rounded-full align-middle', DOT[health])} role="img" aria-label={HEALTH_TEXT[health]} title={HEALTH_TEXT[health]} />
        {total} {pluralRecords(total)}
        {at ? ` · Notion обновлён ${formatSyncTime(new Date(at))}` : ' · Notion ещё не синхронизирован'}
        {onSync && (
          <button
            type="button"
            onClick={onSync}
            disabled={pending}
            aria-label={pending ? 'Синхронизация с Notion идёт' : 'Обновить данные из Notion'}
            title="Обновить данные из Notion"
            className="ml-1 inline-grid h-7 w-7 place-items-center rounded-ctl align-middle text-p-muted transition-colors hover:bg-p-panel2 hover:text-p-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', pending && 'animate-spin')} aria-hidden="true" />
          </button>
        )}
      </p>
      {health === 'error' && status?.last_run?.error && (
        // Плашкой из палитры Notion (red): красный текст на фоне страницы в
        // тёмной теме читался плохо, а у пары фон/текст контраст проверен тестом.
        <div role="alert" className={cn('mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel px-3 py-2 text-xs', notionTagClass('red'))}>
          <span className="min-w-0 flex-1">Ошибка синхронизации: {status.last_run.error}</span>
          {onSync && (
            <button type="button" onClick={onSync} disabled={pending}
              className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {pending ? 'Повторяем…' : 'Повторить'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function pluralRecords(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'запись'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'записи'
  return 'записей'
}
