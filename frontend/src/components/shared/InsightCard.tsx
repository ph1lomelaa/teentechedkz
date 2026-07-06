import { Link } from 'react-router-dom'
import { InsightWithDiff, TELEGRAM_FIELD_LABELS_RU } from '@/types'
import { Button } from '@/components/ui/button'

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
    <div className="border border-gray-100 rounded-[2px] p-3 text-sm space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <span className="text-xs text-gray-500">
          {showStudentLink && insight.student_name && (
            <Link to={`/students/${insight.student_id}`} className="text-blue-600 hover:underline mr-2">
              {insight.student_name}
            </Link>
          )}
          {insight.insight_type}
        </span>
        <div className="flex items-center gap-1.5">
          {insight.risk_level === 'sensitive' && (
            <span className="px-1.5 py-0.5 rounded-[2px] text-[11px] bg-red-50 text-red-700 border border-red-200">
              чувствительно
            </span>
          )}
          {insight.auto_applied && (
            <span className="px-1.5 py-0.5 rounded-[2px] text-[11px] bg-sky-50 text-sky-700 border border-sky-200">
              авто
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded-[2px] text-[11px] bg-gray-50 text-gray-600 border border-gray-200">
            {INSIGHT_STATUS_LABELS[insight.status] ?? insight.status}
          </span>
        </div>
      </div>

      {insight.diff.length > 0 && (
        <div className="space-y-1">
          {insight.diff.map((d) => (
            <div key={d.field} className="text-xs text-gray-700">
              <span className="text-gray-500">{TELEGRAM_FIELD_LABELS_RU[d.field] ?? d.field}: </span>
              {humanizeValue(d.old_value)} → <span className="font-medium">{humanizeValue(d.new_value)}</span>
            </div>
          ))}
        </div>
      )}

      {unmatchedEntries.length > 0 && (
        <div className="space-y-1 bg-amber-50 border border-amber-200 rounded-[2px] p-2">
          <p className="text-[11px] text-amber-800 font-medium">Не сопоставлено с полями профиля:</p>
          {unmatchedEntries.map(([field, value]) => (
            <div key={field} className="text-xs text-amber-900">
              <span className="text-amber-700">{field}: </span>
              {humanizeValue(value)}
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-gray-400">уверенность: {Math.round(insight.confidence * 100)}%</div>

      {insight.status === 'pending' && canReview && (
        <div className="flex gap-1.5 pt-1">
          {canApprove && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={onApprove}>
              Подтвердить
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={onReject}>
            {canApprove ? 'Отклонить' : 'Просмотрено'}
          </Button>
        </div>
      )}
    </div>
  )
}
