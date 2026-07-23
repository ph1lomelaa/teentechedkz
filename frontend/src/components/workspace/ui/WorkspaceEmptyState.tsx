import React from 'react'
import { Users } from 'lucide-react'
import { WorkspaceCard } from './WorkspaceCard'

export function WorkspaceEmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: React.ReactNode
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <WorkspaceCard className="px-8 py-10 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-w-accentDim/25 bg-w-accent/[0.06] text-w-accentText">
        {icon || <Users className="h-6 w-6" />}
      </div>
      <div className="mt-5 font-display text-lg font-black text-w-ink">{title}</div>
      {text && <div className="mx-auto mt-2 max-w-md text-sm text-w-muted">{text}</div>}
      {action && <div className="mt-5">{action}</div>}
    </WorkspaceCard>
  )
}
