import React from 'react'
import { cn } from '@/lib/utils'

export const WorkspaceInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, placeholder, 'aria-label': ariaLabel, ...props }, ref) => (
    <input
      ref={ref}
      placeholder={placeholder}
      aria-label={ariaLabel || placeholder || 'Поле ввода'}
      className={cn(
        'min-h-10 rounded-[11px] border border-w-line bg-w-panel px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 transition focus:border-w-accentDim focus-visible:ring-2 focus-visible:ring-w-accent/50',
        className,
      )}
      {...props}
    />
  ),
)

WorkspaceInput.displayName = 'WorkspaceInput'
