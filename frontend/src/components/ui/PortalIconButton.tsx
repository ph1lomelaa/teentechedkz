import React from 'react'
import { cn } from '@/lib/utils'

export const PortalIconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-ctl border border-p-line bg-p-panel text-p-text transition hover:border-p-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-p-accent disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)

PortalIconButton.displayName = 'PortalIconButton'
