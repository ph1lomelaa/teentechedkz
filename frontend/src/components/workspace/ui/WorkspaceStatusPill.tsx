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
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold',
        tone === 'neutral' && 'border-w-line bg-w-panel2 text-w-muted',
        tone === 'accent' && 'border-w-accentDim/40 bg-w-accent/10 text-w-accentText',
        tone === 'danger' && 'border-w-danger/35 bg-w-danger/10 text-w-danger',
        tone === 'good' && 'border-w-good/35 bg-w-good/10 text-w-good',
        className,
      )}
    >
      {children}
    </span>
  )
}
