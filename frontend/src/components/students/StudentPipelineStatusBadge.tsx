import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'
import { cn } from '@/lib/utils'
import { notionTagClass } from '@/lib/notionColors'

type StatusTone = 'active' | 'waiting' | 'problem' | 'complete' | 'neutral'

/** Convert raw Notion option names to the CRM status keys used by the palette. */
export function normalizeStudentPipelineStatus(status?: string | null): PipelineStatus {
  if (!status) return 'no_status'
  if (status in PIPELINE_STATUS_LABELS) return status as PipelineStatus
  const normalized = status.toLocaleLowerCase('ru')
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
  const exact = Object.entries(PIPELINE_STATUS_LABELS).find(([, label]) => label.toLocaleLowerCase('ru').replace(/[–—]/g, '-').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim() === normalized)
  if (exact) return exact[0] as PipelineStatus
  if (normalized.includes('активная работа')) return 'active_work'
  if (normalized.includes('поступил')) return 'completed_admitted'
  if (normalized.includes('передумал')) return 'changed_mind'
  if (normalized.includes('пропал')) return 'lost_applicant'
  if (normalized.includes('возврат')) return 'refund'
  if (normalized.includes('проблем')) return 'problem'
  if (normalized.includes('подвеш') || normalized.includes('приостанов')) return 'suspended'
  if (normalized.includes('виз')) return 'on_visa'
  if (normalized.includes('пауз')) return 'paused'
  if (normalized.includes('оплач')) return 'unpaid'
  if (normalized.includes('пересдач')) return 'ielts_retake'
  if (normalized.includes('переподач')) return 'reapplication'
  if (normalized.includes('перевел') || normalized.includes('перевёл')) return 'transferred_pipeline'
  return 'no_status'
}

const STATUS_TONES: Record<PipelineStatus, StatusTone> = {
  active_work: 'active',
  on_visa: 'waiting',
  paused: 'waiting',
  completed_admitted: 'complete',
  changed_mind: 'neutral',
  lost_applicant: 'neutral',
  refund: 'problem',
  unpaid: 'waiting',
  transferred_pipeline: 'neutral',
  ielts_retake: 'waiting',
  reapplication: 'waiting',
  problem: 'problem',
  suspended: 'problem',
  no_status: 'neutral',
}

interface StudentPipelineStatusBadgeProps {
  status?: string | null
  notionColor?: string | null
  className?: string
}

export function StudentPipelineStatusBadge({ status, notionColor, className }: StudentPipelineStatusBadgeProps) {
  const key = normalizeStudentPipelineStatus(status)
  const label = status && !(status in PIPELINE_STATUS_LABELS) ? status : PIPELINE_STATUS_LABELS[key]

  return (
    <span className={cn('student-pipeline-status', notionColor && notionTagClass(notionColor), className)} data-tone={STATUS_TONES[key]}>
      <span className="student-pipeline-status__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
