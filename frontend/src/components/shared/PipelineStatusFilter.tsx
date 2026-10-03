import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  PIPELINE_COLUMNS,
  PIPELINE_STATUS_COLORS,
  PIPELINE_STATUS_LABELS,
  PipelineStatus,
} from '@/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'

export type PipelineStatusOperator = 'is' | 'is_not'

/**
 * Статус договора в виде тега, как опция «Статус выплат» в Notion: обычный
 * регистр, мягкий фон, небольшое скругление. Один компонент на все страницы —
 * иначе таблицы, карточка и фильтры снова разъедутся по виду.
 */
export function PipelineStatusTag({
  status,
  className,
}: {
  status: PipelineStatus | null | undefined
  className?: string
}) {
  const value = status ?? 'no_status'
  return (
    <span
      className={cn(
        'inline-block max-w-full truncate whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium',
        PIPELINE_STATUS_COLORS[value],
        className,
      )}
    >
      {PIPELINE_STATUS_LABELS[value] ?? value}
    </span>
  )
}

/** Подпись для чипа активного фильтра: «Статус не На визе». */
export function pipelineStatusChipLabel(status: PipelineStatus, operator: PipelineStatusOperator) {
  return `Статус ${operator === 'is_not' ? 'не ' : ''}${PIPELINE_STATUS_LABELS[status]}`
}

/** Клиентская проверка того же правила, что сервер применяет к `pipeline_statuses`. */
export function matchesPipelineStatusFilter(
  status: PipelineStatus | null | undefined,
  selected: PipelineStatus[],
  operator: PipelineStatusOperator,
) {
  if (!selected.length) return true
  const hit = selected.includes(status ?? 'no_status')
  return operator === 'is_not' ? !hit : hit
}

/**
 * Фильтр по статусу как в Notion: условие «совпадает / не совпадает»,
 * выбранные статусы тегами с крестиком и список тегов с галочками.
 */
export function PipelineStatusFilter({
  value,
  onChange,
  operator,
  onOperatorChange,
  counts,
}: {
  value: PipelineStatus[]
  onChange: (next: PipelineStatus[]) => void
  operator: PipelineStatusOperator
  onOperatorChange: (next: PipelineStatusOperator) => void
  counts?: Partial<Record<string, number>>
}) {
  const toggle = (status: PipelineStatus) =>
    onChange(value.includes(status) ? value.filter((v) => v !== status) : [...value, status])

  return (
    <div className="space-y-2">
      <Select value={operator} onValueChange={(v) => onOperatorChange(v as PipelineStatusOperator)}>
        <SelectTrigger className="h-9 text-sm" aria-label="Условие статуса">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="is">совпадает с</SelectItem>
          <SelectItem value="is_not">не совпадает с</SelectItem>
        </SelectContent>
      </Select>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Выбранные статусы">
          {value.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => toggle(status)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                PIPELINE_STATUS_COLORS[status],
              )}
              title="Убрать статус"
            >
              {PIPELINE_STATUS_LABELS[status]}
              <X className="h-3 w-3 opacity-60" />
            </button>
          ))}
        </div>
      )}
      <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-panel border border-p-line p-1.5">
        {PIPELINE_COLUMNS.map((status) => (
          <label key={status} className="flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1 text-xs hover:bg-p-bg">
            <input
              type="checkbox"
              aria-label={PIPELINE_STATUS_LABELS[status]}
              checked={value.includes(status)}
              onChange={() => toggle(status)}
              className="h-3.5 w-3.5 rounded border-p-line"
            />
            <span className="min-w-0 flex-1">
              <PipelineStatusTag status={status} />
            </span>
            {counts && <span className="text-p-muted2">{counts[status] ?? 0}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}
