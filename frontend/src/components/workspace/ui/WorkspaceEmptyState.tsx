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
    <WorkspaceCard className="p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] border border-w-line bg-w-panel2 text-w-muted2">
        {icon || <Users className="h-5 w-5" />}
      </div>
      <div className="mt-4 font-display text-lg font-black text-w-ink">{title}</div>
      {text && <div className="mx-auto mt-2 max-w-md text-sm text-w-muted">{text}</div>}
      {action && <div className="mt-5">{action}</div>}
    </WorkspaceCard>
  )
}
