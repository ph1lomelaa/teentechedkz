import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'
import { cn } from '@/lib/utils'

type StatusTone = 'active' | 'waiting' | 'problem' | 'complete' | 'neutral'

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
  className?: string
}

export function StudentPipelineStatusBadge({ status, className }: StudentPipelineStatusBadgeProps) {
  const key = status && status in PIPELINE_STATUS_LABELS ? status as PipelineStatus : 'no_status'
  const label = status && key === 'no_status' && status !== 'no_status'
    ? status
    : PIPELINE_STATUS_LABELS[key]

  return (
    <span className={cn('student-pipeline-status', className)} data-tone={STATUS_TONES[key]}>
      <span className="student-pipeline-status__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
