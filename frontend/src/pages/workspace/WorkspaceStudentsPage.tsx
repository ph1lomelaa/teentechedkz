import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Users, X } from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { debounce } from '@/lib/utils'
import { AppCard, AppInput, EmptyState, PageHeader } from '@/components/ui'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { QueryState } from '@/components/shared/QueryState'
import { StudentListRow } from '@/components/workspace/StudentListRow'
import { StudentQuickPanel } from '@/components/workspace/StudentQuickPanel'
import { needsAttention, sortByUrgency } from '@/lib/studentSignals'
import { normalizeStudentPipelineStatus } from '@/components/students/StudentPipelineStatusBadge'
import { MENTOR_ROLE_LABELS, PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'
import { AppSelect } from '@/components/ui'

const statusOf = (item: WorkspaceStudentSummary) => normalizeStudentPipelineStatus(item.student.pipeline_status ?? 'no_status')
import { useLocalState } from '@/lib/use-local-state'

// Панель справа помещается рядом со списком только с lg; на телефоне клик
// ведёт в полную карточку — урезанный дубль карточки там ни к чему.
function isWide() {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1024px)').matches
}

export const WorkspaceStudentsPage: React.FC = () => {
  const navigate = useNavigate()
  const { params, isPreview } = useWorkspaceScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const selectedParam = searchParams.get('s')
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const debouncedSetSearch = useMemo(() => debounce((value: string) => setDebouncedSearch(value), 250), [])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'students', 'summary', params],
    queryFn: () => workspaceApi.students(params),
  })

  const all = useMemo(() => sortByUrgency(data?.items ?? []), [data?.items])
  // Фильтр по году набора: у ментора бывают ученики нескольких наборов сразу.
  const [year, setYear] = useLocalState<string>('workspace:students:year', 'all')
  const years = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of all) {
      const key = item.student.intake_year ? String(item.student.intake_year) : 'none'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(a) - Number(b)))
  }, [all])
  const activeYear = year !== 'all' && years.some(([key]) => key === year) ? year : 'all'
  // Остальные фильтры — строкой сверху рядом с годами: роль, статус, «ждёт меня».
  const [role, setRole] = useLocalState<string>('workspace:students:role', '')
  const [status, setStatus] = useLocalState<string>('workspace:students:status', '')
  const [waiting, setWaiting] = useLocalState<boolean>('workspace:students:waiting', false)
  const [country, setCountry] = useLocalState<string>('workspace:students:country', '')
  const countryOf = (item: WorkspaceStudentSummary) => item.roadmap.country_name || 'none'
  const countries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of all) counts.set(item.roadmap.country_name || 'none', (counts.get(item.roadmap.country_name || 'none') ?? 0) + 1)
    return [...counts].sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b, 'ru')))
  }, [all])
  const count = (pick: (item: WorkspaceStudentSummary) => boolean) => all.filter(pick).length
  const roles = useMemo(() => [...new Set(all.flatMap((item) => item.my_roles))], [all])
  const statuses = useMemo(() => [...new Set(all.map(statusOf))], [all])
  const waitingCount = all.filter(needsAttention).length
  const students = all.filter((item) => activeYear === 'all' || (item.student.intake_year ? String(item.student.intake_year) : 'none') === activeYear)
    .filter((item) => (!role || item.my_roles.includes(role)) && (!status || statusOf(item) === status) && (!country || countryOf(item) === country) && (!waiting || needsAttention(item)))
    .filter((item) => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return true
    return [
      item.student.full_name, item.student.phone, item.student.portal_email, item.student.city,
      item.student.intake_year, item.roadmap.country_name, item.roadmap.year, item.roadmap.name,
    ].some((value) => String(value || '').toLowerCase().includes(q))
  })
  const selected = students.find((item) => item.student.id === selectedParam) ?? students[0]

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const select = (id: string) => {
    if (!isWide()) {
      navigate(`/workspace/students/${id}`)
      return
    }
    setParam('s', id)
  }

  // Поиск спрятал выбранного — подсветка переезжает на первого видимого.
  useEffect(() => {
    if (selectedParam && selected && selected.student.id !== selectedParam) setParam('s', null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагируем только на смену видимого списка
  }, [selected?.student.id, selectedParam])

  const onRowKey = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step) {
      event.preventDefault()
      const next = students[index + step]
      if (!next) return
      setParam('s', next.student.id)
      rowRefs.current[next.student.id]?.focus()
    } else if (event.key === 'Enter' && event.target === event.currentTarget && selected?.student.id === students[index].student.id) {
      event.preventDefault()
      navigate(`/workspace/students/${students[index].student.id}`)
    }
  }

  return (
    <div className="fade-in">
      <PageHeader
        colorPrefix="w"
        eyebrow={isPreview ? 'Студенты выбранного ментора' : 'Мои студенты'}
        title="Студенты"
        description={isPreview ? 'Студенты выбранного сотрудника: roadmap и текущий прогресс.' : 'Сверху те, кому вы нужны сейчас: встреча сегодня, нет roadmap или что-то ждёт проверки.'}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]">
        <div className="min-w-0">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" />
            <AppInput
              colorPrefix="w"
              aria-label="Поиск студентов"
              value={search}
              onChange={(e) => { setSearch(e.target.value); debouncedSetSearch(e.target.value) }}
              placeholder="Имя, телефон, страна или год"
              className="h-11 w-full bg-w-panel2 pl-10 pr-11"
            />
            {search && (
              <button type="button" aria-label="Очистить поиск" onClick={() => { setSearch(''); setDebouncedSearch('') }} className="absolute right-3 top-1/2 -translate-y-1/2 text-w-muted2 transition hover:text-w-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Все фильтры одной строкой сверху: набор, роль, статус, страна и «ждёт меня». */}
          {all.length > 0 && (
            <div className="mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1" aria-label="Фильтры студентов">
              <AppSelect colorPrefix="w" aria-label="Набор" value={activeYear === 'all' ? '' : activeYear} onChange={(e) => setYear(e.target.value || 'all')} className="h-9 min-h-9 w-[112px] shrink-0 truncate px-2.5 text-xs">
                <option value="">Набор</option>
                {years.map(([key, n]) => <option key={key} value={key}>{key === 'none' ? 'Без года' : `Набор ${key}`} · {n}</option>)}
              </AppSelect>
              <AppSelect colorPrefix="w" aria-label="Моя роль" value={role} onChange={(e) => setRole(e.target.value)} className="h-9 min-h-9 w-[112px] shrink-0 truncate px-2.5 text-xs">
                <option value="">Роль</option>
                {roles.map((r) => <option key={r} value={r}>{MENTOR_ROLE_LABELS[r] ?? r} · {count((item) => item.my_roles.includes(r))}</option>)}
              </AppSelect>
              <AppSelect colorPrefix="w" aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 min-h-9 w-[112px] shrink-0 truncate px-2.5 text-xs">
                <option value="">Статус</option>
                {statuses.map((st) => <option key={st} value={st}>{PIPELINE_STATUS_LABELS[st as PipelineStatus] ?? st} · {count((item) => statusOf(item) === st)}</option>)}
              </AppSelect>
              <AppSelect colorPrefix="w" aria-label="Страна" value={country} onChange={(e) => setCountry(e.target.value)} className="h-9 min-h-9 w-[112px] shrink-0 truncate px-2.5 text-xs">
                <option value="">Страна</option>
                {countries.map(([key, n]) => <option key={key} value={key}>{key === 'none' ? 'Страна не указана' : key} · {n}</option>)}
              </AppSelect>
              <button type="button" aria-pressed={waiting} onClick={() => setWaiting(!waiting)}
                className={`h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-bold transition ${waiting ? 'border-w-accent bg-w-accent text-black' : 'border-w-line text-w-muted hover:text-w-ink'}`}>
                Ждёт меня <span className="opacity-70">· {waitingCount}</span>
              </button>
              {(role || status || country || waiting || activeYear !== 'all') && <button type="button" aria-label="Сбросить" title="Сбросить фильтры" onClick={() => { setRole(''); setStatus(''); setCountry(''); setWaiting(false); setYear('all') }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-w-line text-w-muted hover:text-w-ink"><X className="h-4 w-4" /></button>}
            </div>
          )}

          <QueryState
            colorPrefix="w"
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            skeleton={<div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <AppCard colorPrefix="w" key={i} className="h-16 animate-pulse" />)}</div>}
            isEmpty={students.length === 0}
            empty={(
              <EmptyState
                colorPrefix="w"
                icon={<Users className="h-5 w-5" />}
                title={debouncedSearch || role || status || country || waiting || activeYear !== 'all' ? 'Ничего не найдено' : 'Студентов пока нет'}
                description={debouncedSearch
                  ? 'Измените запрос или очистите поиск.'
                  : isPreview ? 'У выбранного сотрудника пока нет активных назначений.' : 'У вас пока нет активных назначений.'}
              />
            )}
          >
            <div className="space-y-2">
              {students.map((item, index) => (
                <StudentListRow
                  key={item.student.id}
                  ref={(el) => { rowRefs.current[item.student.id] = el }}
                  item={item}
                  selected={selected?.student.id === item.student.id}
                  onSelect={() => select(item.student.id)}
                  onKeyDown={onRowKey(index)}
                />
              ))}
            </div>
          </QueryState>
        </div>

        {selected && <StudentQuickPanel key={selected.student.id} item={selected} className="sticky top-6 hidden max-h-[calc(100vh-3rem)] overflow-y-auto lg:block" />}
      </div>
    </div>
  )
}
