import React from 'react'
import { cn } from '@/lib/utils'

export const WorkspaceCard: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'rounded-[var(--w-card-radius)] border border-w-line bg-w-panel shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03),0_12px_28px_-20px_rgba(0,0,0,0.85)] transition',
      className,
    )}
    {...props}
  />
)
