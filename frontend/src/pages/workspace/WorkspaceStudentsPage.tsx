import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, MessageCircle, Route, Search, Users, X } from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { debounce } from '@/lib/utils'
import { Avatar, AppCard, AppInput, EmptyState, PageHeader, ProgressBar, Pill } from '@/components/ui'

export const WorkspaceStudentsPage: React.FC = () => {
  const { params, isPreview } = useWorkspaceScope()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const scopeTitle = isPreview ? 'Студенты выбранного ментора' : 'Мои студенты'
  const scopeDescription = isPreview
    ? 'Студенты выбранного сотрудника: roadmap и текущий прогресс.'
    : 'Все закреплённые за вами студенты и их прогресс по roadmap.'

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), 250),
    []
  )

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'students', 'summary', params],
    queryFn: () => workspaceApi.students(params),
  })

  const students = (data?.items ?? []).filter((item) => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return true
    return [
      item.student.full_name,
      item.student.phone,
      item.student.portal_email,
      item.student.city,
      item.student.intake_year,
      item.roadmap.country_name,
      item.roadmap.year,
      item.roadmap.name,
    ].some((value) => String(value || '').toLowerCase().includes(q))
  })

  return (
    <div className="fade-in">
      <PageHeader colorPrefix="w"
        eyebrow={scopeTitle}
        title="Студенты"
        description={scopeDescription}
      />

      <div className="mb-5 w-full">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" />
          <AppInput colorPrefix="w"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              debouncedSetSearch(e.target.value)
            }}
            placeholder="Поиск по имени, телефону, стране или году"
            className="h-12 w-full bg-w-panel2 pl-10 pr-11"
          />
          {search && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => { setSearch(''); setDebouncedSearch('') }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-w-muted2 transition hover:text-w-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <AppCard colorPrefix="w" key={i} className="h-52 animate-pulse" />)}
        </div>
      ) : students.length === 0 ? (
        <EmptyState colorPrefix="w"
          icon={<Users className="h-5 w-5" />}
          title={debouncedSearch ? 'Ничего не найдено' : 'Студентов пока нет'}
          description={
            debouncedSearch
              ? 'Измените запрос или очистите поиск.'
              : isPreview
              ? 'У выбранного сотрудника пока нет активных назначений.'
              : 'У вас пока нет активных назначений.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {students.map((item) => (
            <AppCard colorPrefix="w" key={item.student.id} className="flex flex-col p-5 hover:border-w-accentDim">
              <div className="flex items-center gap-3.5">
                <Avatar name={item.student.full_name} size={44} />
                <div className="min-w-0">
                  <Link to={`/workspace/students/${item.student.id}`} className="block truncate font-display text-[15px] font-extrabold text-w-ink hover:text-w-accentText">
                    {item.student.full_name}
                  </Link>
                  <small className="block truncate text-xs text-w-muted">
                    {item.student.portal_email || item.student.phone || 'Контакт не указан'}
                  </small>
                </div>
              </div>

              <div className="mt-4">
                {item.roadmap.id ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="min-w-0 truncate text-[13px] font-bold text-w-ink">{item.roadmap.name || 'Roadmap'}</b>
                    </div>
                    <div className="mt-3">
                      <ProgressBar colorPrefix="w" showLabel={false} value={item.roadmap.progress} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-w-muted">
                      <span>
                        <span className="font-display font-black text-w-accentText">{item.roadmap.progress}%</span>
                        {' '}прогресс
                      </span>
                      <span>{item.open_roadmap_tasks} открытых задач</span>
                    </div>
                  </>
                ) : (
                  <Pill colorPrefix="w" tone="accent">
                    <Route className="h-3.5 w-3.5" />
                    Roadmap не назначен
                  </Pill>
                )}
              </div>

              <div className="mt-auto flex flex-wrap gap-2.5 pt-4">
                <Link to={`/workspace/students/${item.student.id}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-ctl bg-w-accent px-3 py-1.5 text-[11.5px] font-black text-black transition hover:-translate-y-px">
                  Открыть <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link to={`/workspace/chat?student_id=${item.student.id}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText">
                  <MessageCircle className="h-3.5 w-3.5" /> Чат
                </Link>
              </div>
            </AppCard>
          ))}
        </div>
      )}
    </div>
  )
}
