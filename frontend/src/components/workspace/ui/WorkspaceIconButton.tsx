import React from 'react'
import { cn } from '@/lib/utils'

export const WorkspaceIconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-[11px] border border-w-line bg-w-panel text-w-ink transition hover:border-w-accentDim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)

WorkspaceIconButton.displayName = 'WorkspaceIconButton'
