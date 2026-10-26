import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { StudentOverviewRow } from '@/api/activities'
import { cn } from '@/lib/utils'
import { StudentActivities } from './ActivityPlan'

const cardPath = (studentId: string) => `/workspace/students/${studentId}#portfolio`

/** Ученик строкой, как этап Roadmap: по клику раскрываются его активности с шагами. */
function StudentRow({ row, defaultOpen }: { row: StudentOverviewRow; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <li className={cn('rounded-card border bg-ds-panel', open ? 'border-ds-muted2' : 'border-ds-line')}>
    <div className="flex items-center gap-3 p-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <ChevronDown aria-hidden className={cn('h-4 w-4 shrink-0 text-ds-muted transition', !open && '-rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{row.name}</span>
          {row.focus_text && <span className="block truncate text-xs text-ds-muted" title={row.focus_text}>{row.focus_text}</span>}
        </span>
      </button>
      <Link to={cardPath(row.student_id)} className="shrink-0 text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Карточка</Link>
    </div>
    {open && <div className="border-t border-ds-line p-4 sm:p-5"><StudentActivities studentId={row.student_id} compact /></div>}
  </li>
}

/** Список учеников: строка раскрывается активностями ученика — теми же, что в его карточке. */
export function StudentsOverview({ rows, openId }: { rows: StudentOverviewRow[]; openId?: string | null }) {
  if (!rows.length) return <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">Никого не нашли.</p>
  return <ul className="space-y-2">{rows.map((row) => <StudentRow key={row.student_id} row={row} defaultOpen={row.student_id === openId} />)}</ul>
}
