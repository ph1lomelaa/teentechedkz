import React from 'react'
import { cn } from '@/lib/utils'

interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  hoverable?: boolean
}

export const AppCard = React.forwardRef<HTMLDivElement, AppCardProps>(
  ({ className, hoverable = false, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-card border border-ds-line bg-ds-panel p-[22px]',
        hoverable && 'transition hover:-translate-y-0.5 hover:border-ds-accent-dim',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)

AppCard.displayName = 'AppCard'
