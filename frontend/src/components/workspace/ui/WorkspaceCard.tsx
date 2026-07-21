import React from 'react'
import { cn } from '@/lib/utils'

export const WorkspaceCard: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'rounded-[var(--w-card-radius)] border border-w-line bg-w-panel transition',
      className,
    )}
    {...props}
  />
)
