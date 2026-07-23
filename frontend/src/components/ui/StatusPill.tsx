import React from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle2, Clock3 } from 'lucide-react'

type TaskStatus = 'planned' | 'in_progress' | 'done' | 'overdue'
type ColorPrefix = 'ds' | 'p' | 'w'

interface StatusPillProps {
  status: TaskStatus
  colorPrefix?: ColorPrefix
  size?: 'sm' | 'md'
  showIcon?: boolean
  className?: string
}

const LABELS: Record<TaskStatus, string> = {
  planned: 'В плане',
  in_progress: 'В работе',
  done: 'Готово',
  overdue: 'Просрочено',
}

const getClassForStatus = (status: TaskStatus, prefix: ColorPrefix): string => {
  if (prefix === 'p') {
    const classes: Record<TaskStatus, string> = {
      planned: 'bg-p-line text-p-muted',
      in_progress: 'bg-p-accent text-black',
      done: 'bg-p-good text-black',
      overdue: 'bg-p-danger text-black',
    }
    return classes[status]
  } else if (prefix === 'w') {
    const classes: Record<TaskStatus, string> = {
      planned: 'bg-w-line text-w-muted',
      in_progress: 'bg-w-accent text-black',
      done: 'bg-w-good text-black',
      overdue: 'bg-w-danger text-black',
    }
    return classes[status]
  }
  // Default ds
  const classes: Record<TaskStatus, string> = {
    planned: 'bg-ds-line text-ds-muted',
    in_progress: 'bg-ds-accent text-black',
    done: 'bg-ds-good text-black',
    overdue: 'bg-ds-danger text-black',
  }
  return classes[status]
}

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  colorPrefix = 'ds',
  size = 'sm',
  showIcon = true,
  className,
}) => {
  const baseClasses = size === 'sm'
    ? 'px-2.5 py-1 text-[11px] font-bold'
    : 'px-3.5 py-1.5 text-[12px] font-bold'

  let icon = null
  if (showIcon) {
    if (status === 'done') {
      icon = <CheckCircle2 size={size === 'sm' ? 14 : 16} className="flex-none" />
    } else if (status === 'in_progress' || status === 'overdue') {
      icon = <Clock3 size={size === 'sm' ? 14 : 16} className="flex-none" />
    }
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full',
        baseClasses,
        getClassForStatus(status, colorPrefix),
        className
      )}
    >
      {icon}
      {LABELS[status]}
    </span>
  )
}
