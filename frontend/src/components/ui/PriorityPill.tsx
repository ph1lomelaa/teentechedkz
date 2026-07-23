import React from 'react'
import { cn } from '@/lib/utils'
import { AlertCircle, AlertTriangle, Zap } from 'lucide-react'

type TaskPriority = 'required' | 'recommended' | 'optional'
type ColorPrefix = 'ds' | 'p' | 'w'

interface PriorityPillProps {
  priority: TaskPriority
  colorPrefix?: ColorPrefix
  size?: 'sm' | 'md'
  showIcon?: boolean
  className?: string
}

const LABELS: Record<TaskPriority, string> = {
  required: 'Обязательно',
  recommended: 'Рекомендуется',
  optional: 'По желанию',
}

const getClassForPriority = (priority: TaskPriority, prefix: ColorPrefix): string => {
  if (prefix === 'p') {
    const classes: Record<TaskPriority, string> = {
      required: 'bg-p-accent text-black',
      recommended: 'bg-p-line text-p-text',
      optional: 'bg-p-line text-p-muted',
    }
    return classes[priority]
  } else if (prefix === 'w') {
    const classes: Record<TaskPriority, string> = {
      required: 'bg-w-accent text-black',
      recommended: 'bg-w-line text-w-ink',
      optional: 'bg-w-line text-w-muted',
    }
    return classes[priority]
  }
  // Default ds
  const classes: Record<TaskPriority, string> = {
    required: 'bg-ds-accent text-black',
    recommended: 'bg-ds-line text-ds-text',
    optional: 'bg-ds-line text-ds-muted',
  }
  return classes[priority]
}

export const PriorityPill: React.FC<PriorityPillProps> = ({
  priority,
  colorPrefix = 'ds',
  size = 'sm',
  showIcon = true,
  className,
}) => {
  const baseClasses = size === 'sm'
    ? 'px-2.5 py-1 text-[10.5px] font-bold'
    : 'px-3 py-1.5 text-[11px] font-bold'

  let icon = null
  if (showIcon) {
    if (priority === 'required') {
      icon = <AlertCircle size={size === 'sm' ? 12 : 14} className="flex-none" />
    } else if (priority === 'recommended') {
      icon = <AlertTriangle size={size === 'sm' ? 12 : 14} className="flex-none" />
    } else if (priority === 'optional') {
      icon = <Zap size={size === 'sm' ? 12 : 14} className="flex-none" />
    }
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full tracking-wide',
        baseClasses,
        getClassForPriority(priority, colorPrefix),
        className
      )}
    >
      {icon}
      {LABELS[priority]}
    </span>
  )
}
