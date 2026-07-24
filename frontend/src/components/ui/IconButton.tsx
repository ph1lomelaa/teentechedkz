import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  colorPrefix?: ColorPrefix
}

const CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-line bg-ds-panel text-ds-ink hover:border-ds-accent-dim focus-visible:ring-ds-accent',
  p: 'border-p-line bg-p-panel text-p-text hover:border-p-accent-dim focus-visible:ring-p-accent',
  w: 'border-w-line bg-w-panel text-w-ink hover:border-w-accentDim focus-visible:ring-w-accent',
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, colorPrefix = 'ds', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'grid h-11 w-11 place-items-center rounded-ctl border transition focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
        CLASS[colorPrefix],
        className,
      )}
      {...props}
    />
  ),
)

IconButton.displayName = 'IconButton'
