import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Users, X } from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { debounce } from '@/lib/utils'
import { AppCard, AppInput, EmptyState, PageHeader } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { StudentListRow } from '@/components/workspace/StudentListRow'
import { StudentQuickPanel } from '@/components/workspace/StudentQuickPanel'
import { sortByUrgency } from '@/lib/studentSignals'

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
  const students = all.filter((item) => {
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
                title={debouncedSearch ? 'Ничего не найдено' : 'Студентов пока нет'}
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
