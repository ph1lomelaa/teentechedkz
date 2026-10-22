import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Filter, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TaskQueue, TaskQueueHead, type RowActions } from './TaskQueue'
import { groupByStudent, type SortDir, type SortKey, type WorkItem } from './workItems'

/** Сколько групп раскрыто сразу, если ни у кого нет просрочки и проверки. */
const OPEN_BY_DEFAULT = 3

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/**
 * Очередь задач, разложенная по студентам: у ментора 100+ шагов roadmap,
 * и сплошным списком непонятно, у кого что горит. Свёрнутая группа — это
 * строка со счётчиками; раскрытая — та же таблица, что и в плоском виде.
 */
export const TaskGroups: React.FC<{
  items: WorkItem[]
  actions: RowActions
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  canCreate: boolean
  onCreate: (student: { id: string; name: string }) => void
  onFocusStudent: (id: string) => void
}> = ({ items, actions, sortKey, sortDir, onSort, canCreate, onCreate, onFocusStudent }) => {
  const groups = groupByStudent(items)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const defaultOpen = (index: number, group: (typeof groups)[number]) =>
    groups.length <= OPEN_BY_DEFAULT || group.overdue > 0 || group.review > 0 || index < OPEN_BY_DEFAULT
  const isOpen = (index: number, group: (typeof groups)[number]) => toggled[group.key] ?? defaultOpen(index, group)
  const allOpen = groups.every((group, index) => isOpen(index, group))
  const setAll = (open: boolean) => setToggled(Object.fromEntries(groups.map((group) => [group.key, open])))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-w-muted">
        <span className="tabular-nums">
          {groups.length} {plural(groups.length, 'студент', 'студента', 'студентов')} · {items.length} {plural(items.length, 'задача', 'задачи', 'задач')}
        </span>
        <button type="button" onClick={() => setAll(!allOpen)} className="font-bold text-w-ink hover:text-w-accentText">
          {allOpen ? 'Свернуть все' : 'Развернуть все'}
        </button>
      </div>
      <TaskQueueHead sortKey={sortKey} sortDir={sortDir} onSort={onSort} hideStudent />
      {groups.map((group, index) => {
        const open = isOpen(index, group)
        const nextDue = group.items.flatMap((item) => item.due ? [item.due] : []).sort()[0]
        return (
          <section key={group.key} className="overflow-hidden rounded-card border border-w-line bg-w-panel">
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', open && 'border-b border-w-line')}>
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? 'Свернуть' : 'Развернуть'}: ${group.studentName}`}
                onClick={() => setToggled((current) => ({ ...current, [group.key]: !open }))}
                className="flex w-full min-w-0 flex-wrap items-center gap-2 text-left sm:w-auto sm:flex-1"
              >
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-w-muted transition-transform', !open && '-rotate-90')} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-black text-w-ink">{group.studentName}</span>
                <span className="shrink-0 rounded-pill bg-w-panel2 px-2 py-0.5 text-xs tabular-nums text-w-muted">
                  {group.items.length} {plural(group.items.length, 'задача', 'задачи', 'задач')}
                </span>
                {group.overdue > 0 && (
                  <span className="shrink-0 rounded-pill bg-w-danger/10 px-2 py-0.5 text-xs font-bold tabular-nums text-w-danger">
                    просрочено {group.overdue}
                  </span>
                )}
                {group.review > 0 && (
                  <span className="shrink-0 rounded-pill bg-w-accent/15 px-2 py-0.5 text-xs font-bold tabular-nums text-w-accentText">
                    на проверке {group.review}
                  </span>
                )}
                {!open && nextDue && <span className="hidden shrink-0 text-xs text-w-muted2 sm:inline">ближайший срок {new Date(nextDue).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>}
              </button>
              {group.studentId && (
                <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => onFocusStudent(group.studentId!)}
                    title="Показать только задачи этого студента"
                    className="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-xs font-bold text-w-muted transition hover:bg-w-panel2 hover:text-w-ink"
                  >
                    <Filter className="h-3.5 w-3.5" aria-hidden />Отдельно
                  </button>
                  <Link
                    to={`/workspace/students/${group.studentId}#roadmap`}
                    className="inline-flex h-8 items-center rounded-ctl px-2 text-xs font-bold text-w-muted transition hover:bg-w-panel2 hover:text-w-ink"
                  >
                    Карточка
                  </Link>
                  {canCreate && (
                    <button
                      type="button"
                      onClick={() => onCreate({ id: group.studentId!, name: group.studentName })}
                      className="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-xs font-bold text-w-accentText transition hover:bg-w-accent/10"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />Задача
                    </button>
                  )}
                </div>
              )}
            </div>
            {open && <TaskQueue items={group.items} actions={actions} sortKey={sortKey} sortDir={sortDir} onSort={onSort} hideStudent bare />}
          </section>
        )
      })}
    </div>
  )
}
