import React from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  colorPrefix?: 'ds' | 'p' | 'w'
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
  colorPrefix = 'ds',
}) => {
  const textColorClass = colorPrefix === 'p' ? 'text-p-muted2' : colorPrefix === 'w' ? 'text-w-muted2' : 'text-ds-muted2'
  const titleColorClass = colorPrefix === 'p' ? 'text-p-muted' : colorPrefix === 'w' ? 'text-w-muted' : 'text-ds-muted'
  
  return (
    <div
      className={cn(
        `py-9 text-center ${textColorClass}`,
        className
      )}
    >
      {icon && <div className="mx-auto mb-2.5 flex justify-center">{icon}</div>}
      <h2 className={`block text-[13px] font-semibold ${titleColorClass}`}>{title}</h2>
      {description && (
        <p className="text-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
