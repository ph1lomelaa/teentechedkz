import React from 'react'
import { WorkspaceCard } from './WorkspaceCard'

export function WorkspaceStatCard({
  icon,
  label,
  value,
  sub,
  warn,
}: {
  icon?: React.ReactNode
  label: string
  value: string | number
  sub?: string
  warn?: boolean
}) {
  return (
    <WorkspaceCard className="p-5">
      <div className={warn ? 'text-w-accentText' : 'text-w-muted'}>{icon}</div>
      <div className="mt-3 font-display text-2xl font-black text-w-ink">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-w-muted">{label}</div>
      {sub && <div className="mt-2 text-xs text-w-muted2">{sub}</div>}
    </WorkspaceCard>
  )
}
