import React from 'react'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { Avatar } from '@/components/ui'
import { attentionTone, studentHeadline } from '@/lib/studentSignals'
import { cn } from '@/lib/utils'

const DOT: Record<string, string> = {
  danger: 'bg-w-danger',
  accent: 'bg-w-accent',
}

const HEADLINE: Record<string, string> = {
  danger: 'text-w-danger',
  accent: 'text-w-accentText',
  none: 'text-w-muted',
}

export const StudentListRow = React.forwardRef<HTMLButtonElement, {
  item: WorkspaceStudentSummary
  selected: boolean
  onSelect: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
}>(({ item, selected, onSelect, onKeyDown }, ref) => {
  const headline = studentHeadline(item)
  const tone = attentionTone(item)
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'flex w-full items-center gap-3.5 rounded-panel border px-4 py-3 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accentDim',
        // Подсветка выбора нужна только рядом с панелью (lg+), на телефоне строка — просто ссылка.
        'border-w-line bg-w-panel hover:border-w-accentDim hover:bg-w-panel2',
        selected && 'lg:border-w-accent lg:bg-w-panel2 lg:hover:border-w-accent',
      )}
    >
      <Avatar name={item.student.full_name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold text-w-ink">{item.student.full_name}</span>
        <span className={cn('mt-0.5 block truncate text-xs', HEADLINE[headline.tone])}>{headline.text}</span>
      </span>
      {tone !== 'none' && <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', DOT[tone])} />}
    </button>
  )
})
StudentListRow.displayName = 'StudentListRow'
