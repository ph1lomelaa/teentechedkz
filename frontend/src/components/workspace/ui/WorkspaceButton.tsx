import React from 'react'
import { cn } from '@/lib/utils'

type WorkspaceButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

const variantClass = {
  primary: 'bg-w-accent text-black hover:-translate-y-px',
  ghost: 'border border-w-line bg-transparent text-w-muted hover:border-w-accentDim hover:text-w-accentText',
  soft: 'border border-w-line bg-w-panel2 text-w-ink hover:border-w-accentDim',
  danger: 'border border-w-danger/50 bg-w-danger/10 text-w-danger hover:bg-w-danger/15',
}

const sizeClass = {
  sm: 'min-h-8 px-3 py-1.5 text-[11.5px]',
  md: 'min-h-10 px-4 py-2 text-xs',
  lg: 'min-h-11 px-5 py-2.5 text-sm',
}

export const WorkspaceButton = React.forwardRef<HTMLButtonElement, WorkspaceButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[11px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent focus-visible:ring-offset-2 focus-visible:ring-offset-w-bg disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  ),
)

WorkspaceButton.displayName = 'WorkspaceButton'
