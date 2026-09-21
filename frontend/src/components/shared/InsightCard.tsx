import { useState } from 'react'
import { Link } from 'react-router-dom'
import { InsightWithDiff, TELEGRAM_FIELD_LABELS_RU } from '@/types'
import { AppCard } from '@/components/ui/AppCard'
import { AppButton } from '@/components/ui/AppButton'

const INSIGHT_STATUS_LABELS: Record<string, string> = {
  pending: 'На проверке',
  approved: 'Подтверждён',
  rejected: 'Отклонён',
}

/** Что за изменение — вместо внутренних `status_update` / `contact_change`. */
export const INSIGHT_TYPE_LABELS: Record<string, string> = {
  status_update: 'Профиль',
  contact_change: 'Контакты',
  document_flag: 'Документы',
  payment_event: 'Оплата',
  service_result: 'Результат услуги',
  call_summary: 'Итог созвона',
}

const UNMATCHED_LABELS: Record<string, string> = {
  context_note: 'Из сообщения',
  suggested_but_uncertain: 'Возможно, но не подтверждено',
}

/** Ниже этого показываем уверенность ИИ как предупреждение; выше — это шум. */
const CONFIDENT = 0.8
const LONG_TEXT = 160

/** Значение для человека. `String()` на объекте печатал «[object Object]». */
export function humanizeInsightValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.map(humanizeInsightValue).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([key, value]) => `${TELEGRAM_FIELD_LABELS_RU[key] ?? key}: ${humanizeInsightValue(value)}`)
      .join('; ')
  }
  return String(v)
}

function isEmpty(v: unknown) {
  return v === null || v === undefined || v === ''
}

/** Длинное сообщение из чата сворачиваем: иначе одна карточка занимает экран. */
function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= LONG_TEXT) return <>{text}</>
  return (
    <>
      {open ? text : `${text.slice(0, LONG_TEXT).trimEnd()}…`}{' '}
      <button
        type="button"
        className="not-italic text-ds-accent hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Свернуть' : 'Показать полностью'}
      </button>
    </>
  )
}

interface InsightCardProps {
  insight: InsightWithDiff
  onApprove: () => void
  onReject: () => void
  isPending?: boolean
  showStudentLink?: boolean
  canReview?: boolean
  /** Без собственной рамки — когда предложения уже собраны в блок студента. */
  embedded?: boolean
}

export function InsightCard({
  insight,
  onApprove,
  onReject,
  isPending,
  showStudentLink,
  canReview = true,
  embedded = false,
}: InsightCardProps) {
  const unmatchedEntries = Object.entries(insight.unmatched_fields || {})
  const canApprove = insight.diff.length > 0 || unmatchedEntries.length > 0
  const showSource = Boolean(insight.source_excerpt) && !insight.unmatched_fields?.context_note

  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ds-muted">
          {showStudentLink && insight.student_name && (
            <Link to={`/students/${insight.student_id}`} className="font-medium text-ds-accent hover:underline">
              {insight.student_name}
            </Link>
          )}
          <span className="rounded-pill border border-ds-line bg-ds-panel2 px-2 py-0.5 text-[11px] font-medium">
            {INSIGHT_TYPE_LABELS[insight.insight_type] ?? 'Изменение'}
          </span>
          {insight.source_created_at && (
            <span>
              {new Date(insight.source_created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {insight.risk_level === 'sensitive' && insight.status === 'pending' && (
            <span className="rounded-pill border border-ds-danger/30 bg-ds-danger/10 px-2 py-0.5 text-[11px] text-ds-danger">
              Проверьте внимательно
            </span>
          )}
          {insight.auto_applied && (
            <span className="rounded-pill border border-ds-line bg-ds-panel2 px-2 py-0.5 text-[11px] text-ds-muted">
              авто
            </span>
          )}
          {insight.status !== 'pending' && (
            <span className="rounded-pill border border-ds-line bg-ds-panel2 px-2 py-0.5 text-[11px] text-ds-muted">
              {INSIGHT_STATUS_LABELS[insight.status] ?? insight.status}
            </span>
          )}
        </div>
      </div>

      {insight.diff.length > 0 && (
        <dl className="space-y-1.5">
          {insight.diff.map((d) => (
            <div key={d.field} className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-xs text-ds-muted sm:pt-0.5">{TELEGRAM_FIELD_LABELS_RU[d.field] ?? d.field}</dt>
              <dd className="text-sm text-ds-ink [overflow-wrap:anywhere]">
                {!isEmpty(d.old_value) && (
                  <>
                    <span className="text-ds-muted line-through">{humanizeInsightValue(d.old_value)}</span>
                    <span className="mx-1.5 text-ds-muted">→</span>
                  </>
                )}
                <span className="font-semibold">{humanizeInsightValue(d.new_value)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {unmatchedEntries.length > 0 && (
        <div className="space-y-1 rounded-panel border border-ds-line bg-ds-panel2 p-2 text-xs text-ds-ink [overflow-wrap:anywhere]">
          {unmatchedEntries.map(([field, value]) => (
            <p key={field}>
              <span className="text-ds-muted">
                {UNMATCHED_LABELS[field] ?? TELEGRAM_FIELD_LABELS_RU[field] ?? field}:{' '}
              </span>
              <LongText text={humanizeInsightValue(value)} />
            </p>
          ))}
        </div>
      )}

      {showSource && (
        // Исходная фраза: без неё «GPA 3.9 → 4.5» не проверить, не открывая чат.
        <p className="border-l-2 border-ds-line pl-2 text-xs italic text-ds-muted [overflow-wrap:anywhere]">
          {insight.source_sender && <span className="font-medium not-italic">{insight.source_sender}: </span>}
          <LongText text={insight.source_excerpt ?? ''} />
        </p>
      )}

      {insight.status === 'pending' && insight.confidence < CONFIDENT && (
        <p className="text-xs text-ds-muted2">ИИ не уверен: {Math.round(insight.confidence * 100)}%</p>
      )}

      {insight.status === 'pending' && canReview && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {canApprove && (
            <AppButton size="sm" variant="ghost" disabled={isPending} onClick={onApprove}>
              Подтвердить
            </AppButton>
          )}
          <AppButton size="sm" variant="subtle" disabled={isPending} onClick={onReject}>
            {canApprove ? 'Отклонить' : 'Просмотрено'}
          </AppButton>
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="space-y-2 border-t border-ds-line pt-3 text-sm first:border-t-0 first:pt-0">{body}</div>
  }
  return <AppCard className="space-y-2 p-3 text-sm">{body}</AppCard>
}
