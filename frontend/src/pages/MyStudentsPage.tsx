import React, { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, SlidersHorizontal, Users, X } from 'lucide-react'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import {
  DEGREE_LEVEL_COLORS,
  DEGREE_LEVEL_LABELS,
  MENTOR_ROLE_LABELS,
  PIPELINE_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  type PipelineStatus,
  type ServiceType,
  type StudentListItem,
} from '@/types'
import { matchesOperationalFilter, OPERATIONAL_FILTER_LABELS, type OperationalFilter } from '@/lib/studentFilters'
import { useLocalState } from '@/lib/use-local-state'
import { Input } from '@/components/ui/primitives/input'
import { Button } from '@/components/ui/primitives/button'
import { PageHeader } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { PipelineStatusTag } from '@/components/shared/PipelineStatusFilter'
import { cn } from '@/lib/utils'

/**
 * «Мои студенты» в CRM: как общая база — фильтры колонкой слева, справа таблица
 * по наборам. Список грузится целиком (у сотрудника десятки учеников), фильтры
 * считаются на месте — так у каждого варианта виден честный счётчик.
 */
type Filters = {
  years: string[]; statuses: string[]; degrees: string[]; countries: string[]
  services: string[]; roles: string[]; operational: OperationalFilter
}
const EMPTY: Filters = { years: [], statuses: [], degrees: [], countries: [], services: [], roles: [], operational: 'all' }

const yearOf = (s: StudentListItem) => (s.intake_year ? String(s.intake_year) : 'none')
const statusOf = (s: StudentListItem) => s.pipeline_status ?? 'no_status'
const countriesOf = (s: StudentListItem) => {
  const list = (s.countries ?? []).map((c) => c.country).filter(Boolean)
  return list.length ? list : ['none']
}
const servicesOf = (s: StudentListItem) => [...new Set((s.services_summary?.items ?? []).map((i) => i.service_type))]

function tally(items: StudentListItem[], pick: (s: StudentListItem) => string | string[]) {
  const counts = new Map<string, number>()
  for (const item of items) for (const key of new Set(([] as string[]).concat(pick(item)))) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

const byYear = ([a]: [string, number], [b]: [string, number]) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(a) - Number(b))
const byName = ([a]: [string, number], [b]: [string, number]) => (a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b, 'ru'))

const FilterGroup: React.FC<{
  title: string
  options: [string, string, number][]
  selected: string[]
  onChange: (next: string[]) => void
}> = ({ title, options, selected, onChange }) => {
  if (options.length < 2 && !selected.length) return null
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-p-muted2">{title}</legend>
      {options.map(([value, label, count]) => (
        <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-p-text">
          <input type="checkbox" checked={selected.includes(value)}
            onChange={(e) => onChange(e.target.checked ? [...selected, value] : selected.filter((v) => v !== value))} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="text-xs text-p-muted2">{count}</span>
        </label>
      ))}
    </fieldset>
  )
}

export const MyStudentsPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [stored, setStored] = useLocalState<Filters>('my-students:filters', EMPTY)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const f: Filters = { ...EMPTY, ...stored }
  const set = (patch: Partial<Filters>) => setStored({ ...f, ...patch })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-students', 'all'],
    queryFn: () => studentsApi.list({ scope: 'mine', page: 1, size: 2000 }),
  })
  const all = useMemo(() => data?.items ?? [], [data?.items])
  const myRoles = (s: StudentListItem) => (s.responsibles ?? []).filter((r) => r.id === user?.id && r.is_active !== false && r.role).map((r) => r.role as string)

  const options = useMemo(() => ({
    years: [...tally(all, yearOf)].sort(byYear).map(([k, n]) => [k, k === 'none' ? 'Без года' : `Набор ${k}`, n] as [string, string, number]),
    statuses: [...tally(all, statusOf)].map(([k, n]) => [k, PIPELINE_STATUS_LABELS[k as PipelineStatus] ?? k, n] as [string, string, number]),
    degrees: [...tally(all, (s) => s.degree_level)].map(([k, n]) => [k, DEGREE_LEVEL_LABELS[k as keyof typeof DEGREE_LEVEL_LABELS] ?? k, n] as [string, string, number]),
    countries: [...tally(all, countriesOf)].sort(byName).map(([k, n]) => [k, k === 'none' ? 'Страна не указана' : k, n] as [string, string, number]),
    services: [...tally(all, servicesOf)].map(([k, n]) => [k, SERVICE_TYPE_LABELS[k as ServiceType] ?? k, n] as [string, string, number]),
    roles: [...tally(all, (s) => (s.responsibles ?? []).filter((r) => r.id === user?.id && r.is_active !== false && r.role).map((r) => r.role as string))]
      .map(([k, n]) => [k, MENTOR_ROLE_LABELS[k] ?? k, n] as [string, string, number]),
  }), [all, user?.id])

  const q = search.trim().toLowerCase()
  const students = all.filter((s) =>
    (!f.years.length || f.years.includes(yearOf(s)))
    && (!f.statuses.length || f.statuses.includes(statusOf(s)))
    && (!f.degrees.length || f.degrees.includes(s.degree_level))
    && (!f.countries.length || countriesOf(s).some((c) => f.countries.includes(c)))
    && (!f.services.length || servicesOf(s).some((t) => f.services.includes(t)))
    && (!f.roles.length || myRoles(s).some((r) => f.roles.includes(r)))
    && matchesOperationalFilter(s, f.operational)
    && (!q || [s.full_name, s.phone, s.city, ...countriesOf(s)].some((v) => String(v || '').toLowerCase().includes(q))))
  const groups = useMemo(() => {
    const map = new Map<string, StudentListItem[]>()
    for (const s of students) map.set(yearOf(s), [...(map.get(yearOf(s)) ?? []), s])
    return [...map].sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(a) - Number(b)))
  }, [students])
  const active = f.years.length + f.statuses.length + f.degrees.length + f.countries.length + f.services.length + f.roles.length + (f.operational !== 'all' ? 1 : 0)

  const panel = (
    <div className="space-y-5">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
        <Input aria-label="Поиск студентов" placeholder="Имя, телефон, страна" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-9" />
        {search && <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-p-muted2 hover:text-p-text"><X className="h-4 w-4" /></button>}
      </div>
      <label className="grid gap-1.5 text-2xs font-bold uppercase tracking-wide text-p-muted2">Контроль работы
        <select aria-label="Контроль работы" value={f.operational} onChange={(e) => set({ operational: e.target.value as OperationalFilter })}
          className="h-9 w-full min-w-0 rounded-ctl border border-p-line bg-white px-2 text-sm font-normal normal-case tracking-normal text-p-text">
          {Object.entries(OPERATIONAL_FILTER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <FilterGroup title="Набор" options={options.years} selected={f.years} onChange={(years) => set({ years })} />
      <FilterGroup title="Статус" options={options.statuses} selected={f.statuses} onChange={(statuses) => set({ statuses })} />
      <FilterGroup title="Моя роль" options={options.roles} selected={f.roles} onChange={(roles) => set({ roles })} />
      <FilterGroup title="Страна" options={options.countries} selected={f.countries} onChange={(countries) => set({ countries })} />
      <FilterGroup title="Ступень" options={options.degrees} selected={f.degrees} onChange={(degrees) => set({ degrees })} />
      <FilterGroup title="Программа" options={options.services} selected={f.services} onChange={(services) => set({ services })} />
      {active > 0 && <button type="button" onClick={() => setStored(EMPTY)} className="text-xs font-bold text-p-text underline">Сбросить фильтры ({active})</button>}
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Студенты"
        title="Мои студенты"
        description="Студенты с активным назначением в CRM. Эти же студенты будут открываться в личном кабинете ментора."
        action={(
          <div className="flex items-center gap-3">
            <span className="label-caps">Всего: {all.length}</span>
            <Button asChild variant="outline" size="sm">
              <Link to="/students?scope=unassigned"><Users className="mr-2 h-4 w-4" />Назначить студентов</Link>
            </Button>
          </div>
        )}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <details className="rounded-card border border-p-line p-4 lg:hidden">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-p-text"><SlidersHorizontal className="h-4 w-4" />Фильтры{active ? ` · ${active}` : ''}</summary>
          <div className="mt-4">{panel}</div>
        </details>
        <aside aria-label="Фильтры студентов" className="sticky top-6 hidden rounded-card border border-p-line p-4 lg:block">{panel}</aside>

        <div className="min-w-0">
          {isError ? (
            <div role="alert" className="rounded-card border border-p-line p-8 text-center">
              <p className="text-sm font-bold text-p-text">Не удалось загрузить</p>
              <p className="mt-1 text-sm text-p-muted">{getErrorMessage(error, 'Данные не пришли. Проверьте связь и повторите.')}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>Повторить</Button>
            </div>
          ) : isLoading ? (
            <p className="py-8 text-center text-p-muted">Загрузка...</p>
          ) : students.length === 0 ? (
            <div className="rounded-card border border-p-line bg-p-bg px-4 py-6 text-center text-sm text-p-muted">
              {all.length
                ? 'Под выбранные фильтры никто не подходит — измените или сбросьте их.'
                : 'У вас нет активных назначений. Откройте студента и назначьте себя в «Команде ученика» или нажмите «Взять» в общей базе.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-card border border-p-line">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="whitespace-nowrap bg-p-bg text-left text-xs text-p-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Имя</th>
                    <th className="px-3 py-2.5 font-semibold">Ступень</th>
                    <th className="px-3 py-2.5 font-semibold">Статус</th>
                    <th className="px-3 py-2.5 font-semibold">Страна</th>
                    <th className="px-3 py-2.5 font-semibold">Моя роль</th>
                    <th className="px-3 py-2.5 font-semibold">Дней в работе</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([year, items]) => (
                    <Fragment key={year}>
                      <tr className="border-t border-p-line bg-p-bg/60">
                        <td colSpan={7} className="px-3 py-2">
                          <button type="button" aria-expanded={!collapsed.has(year)} onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(year)) next.delete(year); else next.add(year); return next })}
                            className="flex items-center gap-2 text-sm font-bold text-p-text hover:underline">
                            <ChevronRight className={cn('h-4 w-4 text-p-muted transition-transform', !collapsed.has(year) && 'rotate-90')} />
                            {year === 'none' ? 'Без года' : `Набор ${year}`}<span className="text-xs font-normal text-p-muted2">· {items.length}</span>
                          </button>
                        </td>
                      </tr>
                      {!collapsed.has(year) && items.map((s) => (
                        <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)} className="cursor-pointer border-t border-p-line transition hover:bg-p-bg">
                          <td className="px-3 py-2.5 font-medium"><Link to={`/students/${s.id}`} onClick={(e) => e.stopPropagation()} className="text-p-text hover:underline">{s.full_name}</Link></td>
                          <td className="px-3 py-2.5"><span className={`rounded-pill px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[s.degree_level]}`}>{DEGREE_LEVEL_LABELS[s.degree_level]}</span></td>
                          <td className="px-3 py-2.5">{s.pipeline_status ? <PipelineStatusTag status={s.pipeline_status} /> : <span className="text-xs text-p-muted2">—</span>}</td>
                          <td className="px-3 py-2.5 text-p-muted">{(s.countries ?? []).map((c) => c.country).join(', ') || '—'}</td>
                          <td className="px-3 py-2.5 text-xs text-p-muted">{myRoles(s).map((r) => MENTOR_ROLE_LABELS[r] ?? r).join(', ') || '—'}</td>
                          <td className="px-3 py-2.5 text-p-muted">{s.days_in_work ?? '—'}</td>
                          <td className="px-2 text-p-muted2"><ChevronRight className="h-4 w-4" /></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
