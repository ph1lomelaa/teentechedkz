import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { AppCard } from '@/components/ui'
import { cn } from '@/lib/utils'

const COLLAPSED_COUNT = 8

/**
 * Все студенты рабочей области — в том числе те, у кого ещё нет задач, —
 * с кнопкой «+ Задача». В группировке roadmap-задач такой студент не виден вовсе,
 * поэтому поставить ему задачу оттуда было нельзя.
 */
export const TaskStudentsPanel: React.FC<{
  students: WorkspaceStudentSummary[]
  canCreate: boolean
  onCreate: (student: { id: string; name: string }) => void
}> = ({ students, canCreate, onCreate }) => {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? students.filter((s) => s.student.full_name.toLowerCase().includes(q)) : students
  }, [students, query])
  const visible = showAll || query.trim() ? filtered : filtered.slice(0, COLLAPSED_COUNT)

  if (students.length === 0) return null

  return (
    <AppCard colorPrefix="w" className="mb-5 p-4" data-testid="task-students-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-w-ink">Ваши студенты</h2>
          <p className="mt-0.5 text-[11px] text-w-muted">Поставьте задачу прямо отсюда · {students.length}</p>
        </div>
        {students.length > COLLAPSED_COUNT && (
          <label className="relative block w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-w-muted2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти студента"
              aria-label="Найти студента"
              className="h-9 w-full rounded-full border border-w-line bg-w-panel2 pl-9 pr-3 text-xs text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
            />
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="px-1 py-3 text-xs text-w-muted">Никто не найден</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((s) => {
            const open = s.open_roadmap_tasks + s.open_internal_tasks
            return (
              <li
                key={s.student.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    to={`/workspace/students/${s.student.id}`}
                    className="block truncate text-sm font-bold text-w-ink hover:text-w-accentText"
                  >
                    {s.student.full_name}
                  </Link>
                  <span className={cn('text-[11px]', open ? 'text-w-muted' : 'text-w-muted2')}>
                    {open ? `Открытых задач: ${open}` : 'Задач нет'}
                  </span>
                </div>
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => onCreate({ id: s.student.id, name: s.student.full_name })}
                    aria-label={`Поставить задачу: ${s.student.full_name}`}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-w-accentDim/50 px-2.5 py-1 text-2xs font-bold text-w-accentText transition hover:bg-w-accent/10 active:scale-[0.98]"
                  >
                    <Plus className="h-3 w-3" />Задача
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!query.trim() && filtered.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-bold text-w-muted transition hover:text-w-accentText"
        >
          {showAll ? 'Свернуть' : `Показать всех · ${filtered.length - COLLAPSED_COUNT} ещё`}
        </button>
      )}
    </AppCard>
  )
}
