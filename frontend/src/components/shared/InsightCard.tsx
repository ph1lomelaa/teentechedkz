import { Link } from 'react-router-dom'
import { InsightWithDiff, TELEGRAM_FIELD_LABELS_RU } from '@/types'
import { AppCard } from '@/components/ui/AppCard'
import { AppButton } from '@/components/ui/AppButton'

const INSIGHT_STATUS_LABELS: Record<string, string> = {
  pending: 'На проверке',
  approved: 'Подтверждён',
  rejected: 'Отклонён',
}

function humanizeValue(v: unknown) {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

interface InsightCardProps {
  insight: InsightWithDiff
  onApprove: () => void
  onReject: () => void
  isPending?: boolean
  showStudentLink?: boolean
  canReview?: boolean
}

export function InsightCard({ insight, onApprove, onReject, isPending, showStudentLink, canReview = true }: InsightCardProps) {
  const unmatchedEntries = Object.entries(insight.unmatched_fields || {})
  const canApprove = insight.diff.length > 0 || unmatchedEntries.length > 0

  return (
    <AppCard className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-xs text-ds-muted">
          {showStudentLink && insight.student_name && (
            <Link to={`/students/${insight.student_id}`} className="mr-2 text-ds-accent hover:underline">
              {insight.student_name}
            </Link>
          )}
          {insight.insight_type}
        </span>
        <div className="flex items-center gap-1.5">
          {insight.risk_level === 'sensitive' && (
            <span className="rounded-[6px] border border-ds-danger/30 bg-ds-danger/10 px-1.5 py-0.5 text-[11px] text-ds-danger">
              чувствительно
            </span>
          )}
          {insight.auto_applied && (
            <span className="rounded-[6px] border border-ds-line bg-ds-panel2 px-1.5 py-0.5 text-[11px] text-ds-muted">
              авто
            </span>
          )}
          <span className="rounded-[6px] border border-ds-line bg-ds-panel2 px-1.5 py-0.5 text-[11px] text-ds-muted">
            {INSIGHT_STATUS_LABELS[insight.status] ?? insight.status}
          </span>
        </div>
      </div>

      {insight.diff.length > 0 && (
        <div className="space-y-1">
          {insight.diff.map((d) => (
            <div key={d.field} className="text-xs text-ds-ink">
              <span className="text-ds-muted">{TELEGRAM_FIELD_LABELS_RU[d.field] ?? d.field}: </span>
              {humanizeValue(d.old_value)} → <span className="font-bold">{humanizeValue(d.new_value)}</span>
            </div>
          ))}
        </div>
      )}

      {unmatchedEntries.length > 0 && (
        <div className="space-y-1 rounded-[8px] border border-ds-accent-dim/40 bg-ds-accent/10 p-2">
          <p className="text-[11px] font-bold text-ds-accent">Не сопоставлено с полями профиля:</p>
          {unmatchedEntries.map(([field, value]) => (
            <div key={field} className="text-xs text-ds-ink">
              <span className="text-ds-accent">{field}: </span>
              {humanizeValue(value)}
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-ds-muted2">уверенность: {Math.round(insight.confidence * 100)}%</div>

      {insight.status === 'pending' && canReview && (
        <div className="flex gap-1.5 pt-1">
          {canApprove && (
            <AppButton size="sm" variant="subtle" disabled={isPending} onClick={onApprove}>
              Подтвердить
            </AppButton>
          )}
          <AppButton size="sm" variant="subtle" disabled={isPending} onClick={onReject}>
            {canApprove ? 'Отклонить' : 'Просмотрено'}
          </AppButton>
        </div>
      )}
    </AppCard>
  )
}
