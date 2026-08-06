import React from 'react'
import { cn } from '@/lib/utils'
import { taskUrgency, Urgency } from '@/lib/taskUrgency'

interface UrgencyBadgeProps {
  dueDate: string | null | undefined
  status: string
  size?: 'sm' | 'md'
  className?: string
}

const LABELS: Record<Urgency, string> = {
  none: '',
  yellow: 'Просрочено < 24ч',
  orange: 'Просрочено 24–48ч',
  red: 'Просрочено 48–72ч',
  critical: 'Критично · > 72ч',
}

const CLASSES: Record<Urgency, string> = {
  none: '',
  yellow: 'bg-amber-50 text-amber-700 border border-amber-200',
  orange: 'bg-orange-50 text-orange-700 border border-orange-200',
  red: 'bg-red-50 text-red-700 border border-red-200',
  critical: 'bg-black text-white border border-black',
}

export const UrgencyBadge: React.FC<UrgencyBadgeProps> = ({ dueDate, status, size = 'sm', className }) => {
  const urgency = taskUrgency(dueDate, status)
  if (urgency === 'none') return null

  const baseClasses = size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs'

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-pill font-medium uppercase tracking-wide',
        baseClasses,
        CLASSES[urgency],
        className
      )}
    >
      {LABELS[urgency]}
    </span>
  )
}
