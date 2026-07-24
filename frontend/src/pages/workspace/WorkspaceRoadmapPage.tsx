import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Route, Search } from 'lucide-react'
import type { Roadmap } from '@/api/roadmap'
import { workspaceApi } from '@/api/workspace'
import { WorkspaceRoadmapEditor } from '@/components/workspace/WorkspaceRoadmapEditor'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn } from '@/lib/utils'
import { AppCard, AppInput, EmptyState, PageHeader, Pill } from '@/components/ui'

export const WorkspaceRoadmapPage: React.FC = () => {
  const { params } = useWorkspaceScope()
  const [search, setSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [studentListOpen, setStudentListOpen] = useState(false)
  const [updatedRoadmaps, setUpdatedRoadmaps] = useState<Record<string, Roadmap>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'roadmaps', 'full', params],
    queryFn: () => workspaceApi.fullRoadmaps(params),
  })

  const rows = useMemo(() => data?.items ?? [], [data?.items])
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => !q || row.student.full_name.toLowerCase().includes(q))
  }, [rows, search])
  const visibleRows = rows.filter((row) => !studentId || row.student.id === studentId)
  const missing = rows.filter((row) => !row.roadmap).length

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

      {isLoading ? (
        <AppCard colorPrefix="w" className="p-5 text-sm text-w-muted">Загрузка roadmap...</AppCard>
      ) : rows.length === 0 ? (
        <EmptyState colorPrefix="w" title="Студентов нет" description="После назначения студенты появятся здесь." />
      ) : (
        <div className="space-y-5">
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
            <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
              {visibleRows.map((row) => {
                const roadmap = updatedRoadmaps[row.student.id] || row.roadmap
                return (
                  <AppCard colorPrefix="w" key={row.student.id} className="min-w-0 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-w-line pb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Route className="h-4 w-4 shrink-0 text-w-accentText" />
                          <h2 className="truncate font-display text-lg font-black text-w-ink">{row.student.full_name}</h2>
                        </div>
                        <div className="mt-1 truncate text-xs text-w-muted">{roadmap?.name || 'Roadmap не назначен'}</div>
                      </div>
                      {roadmap && (
                        <Pill colorPrefix="w">
                          {roadmap.country_flag_emoji ? `${roadmap.country_flag_emoji} ` : ''}
                          {roadmap.country_name || 'Страна не указана'}
                        </Pill>
                      )}
                    </div>

                    {roadmap ? (
                      <WorkspaceRoadmapEditor
                        roadmap={roadmap}
                        onChanged={(updated) => setUpdatedRoadmaps((current) => ({ ...current, [row.student.id]: updated }))}
                      />
                    ) : (
                      <EmptyState colorPrefix="w"
                        icon={<Route className="h-5 w-5" />}
                        title="Roadmap не назначен"
                        description="Назначение roadmap будет добавлено в кабинет отдельным действием."
                      />
                    )}
                  </AppCard>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
