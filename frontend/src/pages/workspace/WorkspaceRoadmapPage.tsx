import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Search } from 'lucide-react'
import type { Roadmap } from '@/api/roadmap'
import { workspaceApi } from '@/api/workspace'
import { WorkspaceRoadmapCard } from '@/components/workspace/WorkspaceRoadmapCard'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn } from '@/lib/utils'
import { roadmapDeadlineSummary } from '@/lib/roadmapSummary'
import { AppCard, AppInput, EmptyState, PageHeader } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'

export const WorkspaceRoadmapPage: React.FC = () => {
  const { params } = useWorkspaceScope()
  const [search, setSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [studentListOpen, setStudentListOpen] = useState(false)
  const [updatedRoadmaps, setUpdatedRoadmaps] = useState<Record<string, Roadmap>>({})
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | 'overdue' | 'next7' | 'withoutDate'>('all')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'roadmaps', 'full', params],
    queryFn: () => workspaceApi.fullRoadmaps(params),
  })

  const rows = useMemo(() => data?.items ?? [], [data?.items])
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => !q || row.student.full_name.toLowerCase().includes(q))
  }, [rows, search])
  const summaries = useMemo(() => new Map(rows.map((row) => [row.student.id, roadmapDeadlineSummary(updatedRoadmaps[row.student.id] || row.roadmap)])), [rows, updatedRoadmaps])
  const visibleRows = rows.filter((row) => {
    if (studentId && row.student.id !== studentId) return false
    const summary = summaries.get(row.student.id)
    return deadlineFilter === 'all' || Boolean(summary?.[deadlineFilter])
  })
  const missing = visibleRows.filter((row) => !(updatedRoadmaps[row.student.id] || row.roadmap)).length
  const rowGroups = [
    { key: 'assigned', items: visibleRows.filter((row) => Boolean(updatedRoadmaps[row.student.id] || row.roadmap)) },
    { key: 'missing', items: visibleRows.filter((row) => !(updatedRoadmaps[row.student.id] || row.roadmap)) },
  ]
  const totals = rows.reduce((sum, row) => {
    const summary = summaries.get(row.student.id)
    sum.overdue += summary?.overdue ?? 0
    sum.next7 += summary?.next7 ?? 0
    sum.withoutDate += summary?.withoutDate ?? 0
    return sum
  }, { overdue: 0, next7: 0, withoutDate: 0 })

  return (
    <div className="fade-in">
      <PageHeader colorPrefix="w"
        eyebrow="Кабинет ментора"
        title="Roadmap"
        description="Полный путь каждого студента: этапы, задачи, сроки и прогресс — на одном экране."
      />

      {missing > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-card border border-w-accentDim/40 bg-w-accent/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-w-accentText" />
          <div className="text-sm font-bold text-w-accentText">Без roadmap: {missing}</div>
        </div>
      )}

      <QueryState
        colorPrefix="w"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={rows.length === 0}
        empty={(
          <EmptyState colorPrefix="w" title="Студентов нет" description="После назначения студенты появятся здесь." />
        )}
      >
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2" aria-label="Фильтр сроков roadmap">
            {([
              ['all', `Все студенты · ${rows.length}`],
              ['overdue', `Просрочено · ${totals.overdue}`],
              ['next7', `Следующие 7 дней · ${totals.next7}`],
              ['withoutDate', `Без срока · ${totals.withoutDate}`],
            ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setDeadlineFilter(key)}
              aria-pressed={deadlineFilter === key}
              className={cn('rounded-ctl border px-3 py-2 text-xs font-bold transition', deadlineFilter === key ? 'border-w-accent bg-w-accent text-black' : 'border-w-line bg-w-panel text-w-muted hover:text-w-ink')}>{label}</button>)}
          </div>
          <AppCard colorPrefix="w" className="p-3">
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" />
                <AppInput colorPrefix="w"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setStudentId('')
                    setStudentListOpen(true)
                  }}
                  onFocus={() => setStudentListOpen(true)}
                  onBlur={() => window.setTimeout(() => setStudentListOpen(false), 120)}
                  placeholder="Найти студента"
                  className="w-full bg-w-panel2 pl-9"
                />
              </div>
              {studentListOpen && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-72 overflow-y-auto rounded-panel border border-w-line bg-w-panel p-2 shadow-2xl shadow-black/20">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setStudentId('')
                      setSearch('')
                      setStudentListOpen(false)
                    }}
                    className={cn(
                      'mb-1 flex w-full items-center justify-between rounded-ctl px-3 py-2 text-left text-sm font-bold transition',
                      !studentId ? 'bg-w-accent text-black' : 'text-w-muted hover:bg-w-panel2 hover:text-w-ink',
                    )}
                  >
                    <span>Все студенты</span>
                    <span className={cn('text-xs', !studentId ? 'text-black/60' : 'text-w-muted2')}>{rows.length}</span>
                  </button>
                  {filteredStudents.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-w-muted">Студент не найден</div>
                  ) : (
                    filteredStudents.map((row) => (
                      <button
                        key={row.student.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setStudentId(row.student.id)
                          setSearch(row.student.full_name)
                          setStudentListOpen(false)
                        }}
                        className={cn(
                          'w-full rounded-ctl px-3 py-2 text-left transition',
                          studentId === row.student.id ? 'bg-w-accent text-black' : 'text-w-ink hover:bg-w-panel2',
                        )}
                      >
                        <span className="block truncate text-sm font-bold">{row.student.full_name}</span>
                        <span className={cn('mt-0.5 block truncate text-[11px]', studentId === row.student.id ? 'text-black/60' : 'text-w-muted')}>
                          {row.roadmap?.name || 'Roadmap не назначен'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {studentId && (
                <button
                  type="button"
                  onClick={() => {
                    setStudentId('')
                    setSearch('')
                  }}
                  className="mt-2 inline-flex text-xs font-bold text-w-muted transition hover:text-w-accentText"
                >
                  Сбросить выбор
                </button>
              )}
            </div>
          </AppCard>

          {visibleRows.length === 0 ? (
            <EmptyState colorPrefix="w" title="Ничего не найдено" description="Измените поиск или выберите всех студентов." />
          ) : (
            <div className="space-y-5">
              {rowGroups.filter((group) => group.items.length > 0).map((group) => (
                <div key={group.key} data-roadmap-group={group.key} className={group.key === 'assigned' ? 'min-w-0 columns-1 gap-5 lg:columns-2' : 'grid min-w-0 items-start gap-5 lg:grid-cols-2'}>
                  {group.items.map((row) => (
                    <WorkspaceRoadmapCard
                      key={row.student.id}
                      className={cn('w-full', group.key === 'assigned' && 'mb-5 break-inside-avoid')}
                      studentName={row.student.full_name}
                      roadmap={updatedRoadmaps[row.student.id] || row.roadmap}
                      onChanged={(updated) => setUpdatedRoadmaps((current) => ({ ...current, [row.student.id]: updated }))}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </QueryState>
    </div>
  )
}
