import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
  hoverable?: boolean
  colorPrefix?: ColorPrefix
}

const SURFACE_CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-line bg-ds-panel',
  p: 'border-p-line bg-p-panel',
  w: 'border-w-line bg-w-panel',
}

const HOVER_CLASS: Record<ColorPrefix, string> = {
  ds: 'hover:border-ds-accent-dim',
  p: 'hover:border-p-accent-dim',
  w: 'hover:border-w-accentDim',
}

export const AppCard = React.forwardRef<HTMLDivElement, AppCardProps>(
  ({ className, hoverable = false, colorPrefix = 'ds', children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-card border p-[22px]',
        SURFACE_CLASS[colorPrefix],
        hoverable && cn('transition hover:-translate-y-0.5', HOVER_CLASS[colorPrefix]),
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)

AppCard.displayName = 'AppCard'
