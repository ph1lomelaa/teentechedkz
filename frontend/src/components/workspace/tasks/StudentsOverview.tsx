import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { cn } from '@/lib/utils'
import { formatDue, type StudentRollup } from './workItems'

const GRID = 'xl:grid xl:grid-cols-[minmax(0,2fr)_5rem_6rem_6rem_7rem_16rem] xl:items-center xl:gap-4'

interface Row {
  id: string
  name: string
  open: number
  overdue: number
  review: number
  nextDue: string | null
}

/** Студенты без единой открытой задачи в сводке тоже есть — иначе поставить им задачу было бы неоткуда. */
export function buildStudentRows(
  students: WorkspaceStudentSummary[],
  rollups: StudentRollup[],
  query: string,
): Row[] {
  const byId = new Map(rollups.map((r) => [r.studentId, r]))
  const known = new Set<string>()
  const rows: Row[] = students.map((s) => {
    known.add(s.student.id)
    const r = byId.get(s.student.id)
    return {
      id: s.student.id,
      name: s.student.full_name,
      open: r?.open ?? 0,
      overdue: r?.overdue ?? 0,
      review: r?.review ?? 0,
      nextDue: r?.nextDue ?? null,
    }
  })
  // Студент мог выпасть из сводки рабочей области, но иметь задачу в списке.
  for (const r of rollups) {
    if (!known.has(r.studentId)) {
      rows.push({ id: r.studentId, name: r.studentName, open: r.open, overdue: r.overdue, review: r.review, nextDue: r.nextDue })
    }
  }
  const q = query.trim().toLowerCase()
  return rows
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .sort((a, b) => b.overdue - a.overdue || b.review - a.review || b.open - a.open || a.name.localeCompare(b.name, 'ru'))
}

const Num: React.FC<{ value: number; alert?: boolean; label: string }> = ({ value, alert, label }) => (
  <div className="flex items-baseline justify-between gap-2 xl:block">
    <span className="text-2xs text-w-muted2 xl:hidden">{label}</span>
    <span className={cn('text-sm font-bold tabular-nums', value === 0 ? 'text-w-muted2' : alert ? 'text-w-danger' : 'text-w-ink')}>
      {value}
    </span>
  </div>
)

export const StudentsOverview: React.FC<{
  students: WorkspaceStudentSummary[]
  rollups: StudentRollup[]
  query: string
  canCreate: boolean
  onCreate: (student: { id: string; name: string }) => void
  onFocusStudent: (studentId: string) => void
}> = ({ students, rollups, query, canCreate, onCreate, onFocusStudent }) => {
  const rows = useMemo(() => buildStudentRows(students, rollups, query), [students, rollups, query])

  return (
    <div className="overflow-hidden rounded-card border border-w-line bg-w-panel">
      <div
        role="row"
        className={cn('hidden border-b border-w-line bg-w-panel2 px-4 py-2.5 text-2xs font-bold uppercase tracking-wider text-w-muted2', GRID)}
      >
        <span>Студент</span>
        <span>Открыто</span>
        <span>Просрочено</span>
        <span>На проверке</span>
        <span>Ближайший срок</span>
        <span className="text-right">Действие</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className={cn('border-b border-w-line px-4 py-3 last:border-b-0', GRID)}>
            <div className="min-w-0">
              <Link to={`/workspace/students/${row.id}`} className="block truncate text-sm font-bold text-w-ink hover:text-w-accentText">
                {row.name}
              </Link>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3 xl:contents">
              <Num value={row.open} label="Открыто" />
              <Num value={row.overdue} alert label="Просрочено" />
              <Num value={row.review} label="На проверке" />
            </div>
            <div className="mt-2 text-sm tabular-nums text-w-muted xl:mt-0">
              {row.nextDue ? formatDue(row.nextDue) : <span className="text-w-muted2">—</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 xl:mt-0 xl:justify-end">
              {row.open > 0 && (
                <button
                  type="button"
                  onClick={() => onFocusStudent(row.id)}
                  className="whitespace-nowrap rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-ink transition hover:border-w-accentDim"
                >
                  Задачи студента
                </button>
              )}
              {canCreate && (
                <button
                  type="button"
                  onClick={() => onCreate({ id: row.id, name: row.name })}
                  aria-label={`Поставить задачу: ${row.name}`}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-ctl bg-w-accent px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-95"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />Задача
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="px-4 py-6 text-sm text-w-muted">Никого не найдено.</p>}
    </div>
  )
}
