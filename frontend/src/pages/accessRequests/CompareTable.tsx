import { Check, Minus, AlertTriangle } from 'lucide-react'
import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'
import { cn } from '@/lib/utils'
import { buildComparison, type FieldStatus } from './compare'

const CELL: Record<FieldStatus, string> = {
  match: 'border-l-2 border-st-attach bg-st-attach/15',
  diff: 'border-l-2 border-st-check bg-st-check/15',
  missing: 'border-l-2 border-ds-line bg-ds-panel',
}
const STATUS_LABEL: Record<FieldStatus, string> = {
  match: 'совпало',
  diff: 'расходится',
  missing: 'нет данных',
}

/** Заявка ↔ карточка в две колонки. Цвет не единственный признак: у каждой
 * ячейки есть значок и подпись для скринридера. */
export function CompareTable({ item, card }: { item: AccessRequestItem; card: StudentCandidate }) {
  const rows = buildComparison(item, card)
  return (
    <div
      role="table"
      aria-label={`Сравнение заявки с карточкой ${card.full_name}`}
      className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-[8rem_1fr_1fr]"
    >
      <div role="row" className="contents text-xs font-medium text-ds-muted">
        <span role="columnheader" className="hidden sm:block" />
        <span role="columnheader">Заявка</span>
        <span role="columnheader">Карточка</span>
      </div>
      {rows.map((row) => (
        <div role="row" key={row.key} className="contents">
          <span role="rowheader" className="col-span-2 mt-1 text-xs font-medium text-ds-muted sm:col-span-1 sm:mt-0 sm:self-center">
            {row.label}
          </span>
          {([row.request, row.card] as const).map((value, i) => (
            <span
              role="cell"
              key={i}
              className={cn(
                'flex min-w-0 items-start gap-1.5 rounded-ctl px-2 py-1.5 text-ds-ink',
                CELL[value == null ? 'missing' : row.status],
              )}
            >
              <StatusIcon status={value == null ? 'missing' : row.status} />
              <span className={cn('min-w-0 break-words', value == null && 'text-ds-muted')}>
                {value ?? 'нет данных'}
              </span>
              <span className="sr-only">{STATUS_LABEL[value == null ? 'missing' : row.status]}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function StatusIcon({ status }: { status: FieldStatus }) {
  const cls = 'mt-0.5 h-3.5 w-3.5 shrink-0'
  if (status === 'match') return <Check className={cn(cls, 'text-st-attach')} aria-hidden="true" />
  if (status === 'diff') return <AlertTriangle className={cn(cls, 'text-st-check')} aria-hidden="true" />
  return <Minus className={cn(cls, 'text-ds-muted')} aria-hidden="true" />
}
