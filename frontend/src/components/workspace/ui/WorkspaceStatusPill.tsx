import React from 'react'
import { cn } from '@/lib/utils'

export function WorkspaceStatusPill({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'danger' | 'good'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold',
        tone === 'neutral' && 'bg-w-line text-w-muted',
        tone === 'accent' && 'bg-w-accent text-black',
        tone === 'danger' && 'bg-w-danger text-black',
        tone === 'good' && 'bg-w-good text-black',
        className,
      )}
    >
      {children}
    </span>
  )
}
