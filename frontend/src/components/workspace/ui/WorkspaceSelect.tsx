import React from 'react'
import { cn } from '@/lib/utils'

export const WorkspaceSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, 'aria-label': ariaLabel, ...props }, ref) => (
    <select
      ref={ref}
      aria-label={ariaLabel || 'Выбор значения'}
      className={cn(
        'min-h-10 rounded-[11px] border border-w-line bg-w-panel px-3 text-sm font-bold text-w-ink outline-none transition focus:border-w-accentDim focus-visible:ring-2 focus-visible:ring-w-accent/50',
        className,
      )}
      {...props}
    />
  ),
)

WorkspaceSelect.displayName = 'WorkspaceSelect'
