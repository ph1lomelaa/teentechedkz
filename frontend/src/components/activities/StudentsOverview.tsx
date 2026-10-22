import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { activitiesApi, type StudentOverviewRow } from '@/api/activities'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { cn } from '@/lib/utils'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { EXPERIENCE_TYPES } from '@/lib/activityUi'
import { FilterChip } from './ActivityParts'

type Filter = 'all' | 'waiting' | 'gaps' | 'no_focus'
const TYPES = EXPERIENCE_TYPES.filter((t) => t.key !== 'other')

/** Шесть точек — какие типы опыта уже подтверждены. Подпись в title и для скринридера. */
function ExperienceDots({ row }: { row: StudentOverviewRow }) {
  const have = new Set(row.experience_confirmed)
  const label = TYPES.filter((t) => have.has(t.key)).map((t) => t.short).join(', ') || 'пока ничего'
  return <span className="inline-flex items-center gap-1" title={`Подтверждено: ${label}`}>
    <span className="sr-only">Подтверждено: {label}</span>
    {TYPES.map((t) => <span key={t.key} aria-hidden className={cn('h-2.5 w-2.5 rounded-full', have.has(t.key) ? 'bg-ds-good' : 'bg-ds-line')} />)}
  </span>
}

const planPath = (row: StudentOverviewRow) => `?view=plan&student_id=${row.student_id}`

/** Обзор по ученикам: у кого что есть, что в работе и где ход за ментором. */
export function StudentsOverview() {
  const [search, setSearch] = useState('')
  const [mentor, setMentor] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const mentors = useQuery({ queryKey: ['activities', 'staff-mentors'], queryFn: activitiesApi.staffMentors })
  const query = useQuery({ queryKey: ['activities', 'students-overview', mentor], queryFn: () => activitiesApi.studentsOverview(mentor ? { mentor_id: mentor } : {}) })
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (query.data ?? []).filter((row) => !q || row.name.toLowerCase().includes(q))
  }, [query.data, search])
  const match: Record<Filter, (row: StudentOverviewRow) => boolean> = {
    all: () => true,
    waiting: (row) => row.counts.waiting_mentor > 0,
    gaps: (row) => row.experience_confirmed.length === 0,
    no_focus: (row) => !row.focus_set,
  }
  const shown = rows.filter(match[filter])
    .sort((a, b) => b.counts.waiting_mentor - a.counts.waiting_mentor || b.counts.overdue - a.counts.overdue || a.name.localeCompare(b.name, 'ru'))
  const count = (f: Filter) => rows.filter(match[f]).length
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" aria-hidden /><Input aria-label="Поиск ученика" className="pl-10" placeholder="Имя ученика" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {(mentors.data?.length ?? 0) > 1 && <select aria-label="Фильтр по ментору" className="min-w-0 rounded-ctl border border-ds-line bg-ds-panel p-3 text-sm" value={mentor} onChange={(e) => setMentor(e.target.value)}>
        <option value="">Все менторы</option>{mentors.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>}
    </div>
    <div className="flex flex-wrap gap-2">
      <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={count('all')}>Все</FilterChip>
      <FilterChip active={filter === 'waiting'} onClick={() => setFilter('waiting')} count={count('waiting')}>Ждут меня</FilterChip>
      <FilterChip active={filter === 'gaps'} onClick={() => setFilter('gaps')} count={count('gaps')}>Нет подтверждённых</FilterChip>
      <FilterChip active={filter === 'no_focus'} onClick={() => setFilter('no_focus')} count={count('no_focus')}>Без фокуса</FilterChip>
    </div>
    <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
      <div className="hidden overflow-x-auto rounded-card border border-ds-line bg-ds-panel md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-ds-panel2 text-xs text-ds-muted"><tr>{['Ученик', 'Ждёт меня', 'В работе', 'Подтверждено', 'Типы опыта', 'Ближайший срок', ''].map((t) => <th key={t} className="px-4 py-3 font-semibold">{t}</th>)}</tr></thead>
          <tbody>{shown.map((row) => <tr key={row.student_id} className="border-t border-ds-line">
            <td className="px-4 py-3.5"><Link to={planPath(row)} className="font-bold hover:underline">{row.name}</Link>{!row.focus_set && <p className="mt-0.5 text-xs text-ds-muted">фокус не задан</p>}</td>
            <td className="px-4 py-3.5">{row.counts.waiting_mentor ? <span className="rounded-pill bg-ds-info/15 px-2.5 py-1 text-xs font-bold text-ds-info">{row.counts.waiting_mentor}</span> : <span className="text-ds-muted">—</span>}</td>
            <td className="px-4 py-3.5">{row.counts.active || '—'}{row.counts.overdue > 0 && <span className="ml-2 text-xs font-semibold text-ds-danger">просрочено {row.counts.overdue}</span>}{row.counts.suggested > 0 && <p className="text-xs text-ds-muted">предложено: {row.counts.suggested}</p>}</td>
            <td className="px-4 py-3.5">{row.counts.confirmed ? <span className="inline-flex items-center gap-1 font-bold text-ds-good"><Check className="h-3.5 w-3.5" aria-hidden />{row.counts.confirmed}</span> : <span className="text-ds-muted">—</span>}</td>
            <td className="px-4 py-3.5"><ExperienceDots row={row} /></td>
            <td className="px-4 py-3.5 text-ds-muted">{row.next_deadline ? formatDeadline(row.next_deadline.date) : '—'}</td>
            <td className="px-4 py-3.5 text-right"><Link to={planPath(row)} className="inline-flex rounded-ctl border border-ds-line px-3 py-2 text-xs font-bold hover:border-ds-muted2">Портфолио</Link></td>
          </tr>)}</tbody>
        </table>
        {!shown.length && <p className="p-8 text-center text-sm text-ds-muted">Нет учеников по выбранным фильтрам.</p>}
      </div>
      <ul className="space-y-3 md:hidden">
        {shown.map((row) => <li key={row.student_id}><Link to={planPath(row)} className="block space-y-2 rounded-card border border-ds-line bg-ds-panel p-4">
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-bold">{row.name}</span>{row.counts.waiting_mentor > 0 && <span className="shrink-0 rounded-pill bg-ds-info/15 px-2.5 py-1 text-xs font-bold text-ds-info">ждёт: {row.counts.waiting_mentor}</span>}</div>
          <p className="text-xs text-ds-muted">В работе {row.counts.active} · подтверждено {row.counts.confirmed}{row.counts.overdue ? ` · просрочено ${row.counts.overdue}` : ''}{row.next_deadline ? ` · срок ${formatDeadline(row.next_deadline.date)}` : ''}</p>
          <ExperienceDots row={row} />
        </Link></li>)}
        {!shown.length && <li className="p-6 text-center text-sm text-ds-muted">Нет учеников по выбранным фильтрам.</li>}
      </ul>
    </QueryState>
  </div>
}
