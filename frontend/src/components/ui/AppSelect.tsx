import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

interface AppSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  colorPrefix?: ColorPrefix
}

const CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-line bg-ds-panel text-ds-ink focus:border-ds-accent-dim focus-visible:ring-ds-accent/50',
  p: 'border-p-line bg-p-panel text-p-text focus:border-p-accent-dim focus-visible:ring-p-accent/50',
  w: 'border-w-line bg-w-panel text-w-ink focus:border-w-accentDim focus-visible:ring-w-accent/50',
}

export const AppSelect = React.forwardRef<HTMLSelectElement, AppSelectProps>(
  ({ className, colorPrefix = 'ds', 'aria-label': ariaLabel, ...props }, ref) => (
    <select
      ref={ref}
      aria-label={ariaLabel || 'Выбор значения'}
      className={cn(
        'min-h-10 rounded-ctl border px-3 text-sm font-bold outline-none transition focus-visible:ring-2',
        CLASS[colorPrefix],
        className,
      )}
      {...props}
    />
  ),
)

AppSelect.displayName = 'AppSelect'
