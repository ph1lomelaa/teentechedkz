import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { activitiesApi, type OverviewAction, type OverviewFilter, type StudentOverviewRow } from '@/api/activities'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { cn } from '@/lib/utils'
import { SHELF_TYPES, formatDay, formatDue } from '@/lib/portfolio/dictionary'
import { FilterBar } from './ActivityParts'

const CELL = { filled: 'border border-ds-good bg-ds-good text-white', in_work: 'border border-ds-muted2 bg-ds-panel2 text-ds-ink', empty: 'border border-dashed border-ds-line text-ds-muted' } as const

/** Мини-полка: шесть клеток «Ол Ис Пр Ку Ст Во», подсказка с названием и активностями. */
export function MiniShelf({ row }: { row: StudentOverviewRow }) {
  const cells = SHELF_TYPES.map((t) => ({ type: t, cell: row.shelf?.find((c) => c.key === t.key) }))
  const filled = cells.filter((c) => c.cell?.state === 'filled').length
  const inWork = cells.filter((c) => c.cell?.state === 'in_work').length
  return <div className="space-y-1">
    <ul className="flex gap-1" aria-label={`Полка: ${filled} из 6, в работе ${inWork}`}>
      {cells.map(({ type, cell }) => {
        const state = cell?.state ?? 'empty'
        const titles = [...(cell?.achievements ?? []).map((e) => `✓ ${e.title}`), ...(cell?.in_work ?? []).map((e) => `◐ ${e.title}`)]
        return <li key={type.key} title={[type.label, ...titles].join('\n')}
          className={cn('grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold', CELL[state])}>{type.code}</li>
      })}
    </ul>
    <p className="text-2xs text-ds-muted">{filled} из 6{inWork ? ` · ${inWork} в работе` : ''}</p>
  </div>
}

/** Что сделать ментору и куда за этим идти — один клик до экрана действия. */
function mentorStep(action: OverviewAction, studentId: string): { text: string; cta: string; to: string } {
  if (action.kind === 'review_step') return { text: `Проверить шаг «${action.label}»`, cta: 'Проверить', to: `/workspace/review?item=${action.task_id ?? ''}` }
  if (action.kind === 'review_result') return { text: `Подтвердить итог: ${action.label}`, cta: 'Проверить', to: `/workspace/review?item=result-${action.participation_id}` }
  return { text: `Составить план: ${action.label}`, cta: 'Составить план', to: `/workspace/activities/pick?student=${studentId}&participation=${action.participation_id}&activity=${action.activity_id ?? ''}` }
}

function StudentNeed({ action }: { action: OverviewAction | null | undefined }) {
  if (!action) return <span className="text-ds-muted">Ничего</span>
  if (action.kind === 'overdue') return <span className="font-semibold text-ds-danger">Просрочен «{action.label}»{action.due ? ` · с ${formatDay(action.due)}` : ''} · {action.overdue_days} дн.</span>
  if (action.kind === 'fix') return <span>Исправить «{action.label}»{action.due ? ` · ${formatDue(action.due)}` : ''}</span>
  if (action.kind === 'decide') return <span>Решить по рекомендации{action.due ? ` до ${formatDay(action.due)}` : ''}</span>
  if (action.kind === 'submit_result' || action.kind === 'fix_result') return <span>Отправить итог: {action.label}</span>
  return <span>«{action.label}»{action.due ? ` · ${formatDue(action.due)}` : ''}</span>
}

function MentorNeed({ action, studentId }: { action: OverviewAction | null | undefined; studentId: string }) {
  if (!action) return <span className="text-ds-muted">Ничего</span>
  const step = mentorStep(action, studentId)
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    <span className="min-w-0 flex-1 basis-40">
      {step.text}
      {action.chosen_by_student && <span className="block text-2xs text-ds-muted">ученик выбрал сам</span>}
      {action.stale && <span className="block text-2xs font-semibold text-ds-accentText">в очереди больше суток</span>}
    </span>
    <Link to={step.to} className="shrink-0 rounded-ctl border border-ds-ink px-3 py-1.5 text-xs font-bold hover:bg-ds-panel2">{step.cta}</Link>
  </div>
}

const cardPath = (row: StudentOverviewRow) => `/workspace/students/${row.student_id}#portfolio`

const FILTERS: Array<{ value: OverviewFilter; label: string; match: (row: StudentOverviewRow) => boolean }> = [
  { value: 'all', label: 'Все', match: () => true },
  { value: 'need_me', label: 'Нужно от меня', match: (row) => !!row.mentor_action },
  { value: 'overdue', label: 'Просрочено', match: (row) => row.student_action?.kind === 'overdue' },
  { value: 'no_achievements', label: 'Нет достижений', match: (row) => row.counts.confirmed === 0 },
  { value: 'no_focus', label: 'Без фокуса', match: (row) => !row.focus_set },
]

/** Обзор по ученикам: полка, что нужно от ментора и что нужно от ученика. Порядок задаёт сервер. */
export function StudentsOverview() {
  const [search, setSearch] = useState('')
  const [mentor, setMentor] = useState('')
  const [filter, setFilter] = useState<OverviewFilter>('all')
  const mentors = useQuery({ queryKey: ['activities', 'staff-mentors'], queryFn: activitiesApi.staffMentors })
  const query = useQuery({ queryKey: ['activities', 'students-overview', mentor], queryFn: () => activitiesApi.studentsOverview(mentor ? { mentor_id: mentor } : {}) })
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (query.data ?? []).filter((row) => !q || row.name.toLowerCase().includes(q))
  }, [query.data, search])
  const shown = rows.filter(FILTERS.find((f) => f.value === filter)!.match)
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" aria-hidden /><Input aria-label="Поиск ученика" className="pl-10" placeholder="Имя ученика" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {(mentors.data?.length ?? 0) > 1 && <select aria-label="Фильтр по ментору" className="min-w-0 rounded-ctl border border-ds-line bg-ds-panel p-3 text-sm" value={mentor} onChange={(e) => setMentor(e.target.value)}>
        <option value="">Все менторы</option>{mentors.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>}
    </div>
    <FilterBar label="Фильтр учеников" value={filter} onChange={setFilter}
      options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: f.value === 'all' ? undefined : rows.filter(f.match).length }))} />
    <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
      {!shown.length ? <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">{rows.length ? 'По этому фильтру никого.' : 'Учеников пока нет.'}</p> : <>
        <div className="hidden overflow-x-auto rounded-card border border-ds-line bg-ds-panel md:block">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-ds-panel2 text-xs text-ds-muted"><tr>{['Ученик', 'Полка', 'Нужно от меня', 'Нужно от ученика'].map((t) => <th key={t} className="px-4 py-3 font-semibold">{t}</th>)}</tr></thead>
            <tbody>{shown.map((row) => <tr key={row.student_id} className="border-t border-ds-line align-top">
              <td className="px-4 py-3.5"><Link to={cardPath(row)} className="font-bold hover:underline">{row.name}</Link>
                <p className="mt-0.5 max-w-[16rem] truncate text-xs text-ds-muted" title={row.focus_text ?? undefined}>{row.focus_text ?? <>фокус не задан · <Link to={cardPath(row)} className="underline">задать</Link></>}</p></td>
              <td className="px-4 py-3.5"><MiniShelf row={row} /></td>
              <td className="px-4 py-3.5"><MentorNeed action={row.mentor_action} studentId={row.student_id} /></td>
              <td className="px-4 py-3.5"><StudentNeed action={row.student_action} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">{shown.map((row) => <li key={row.student_id} className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4">
          <div className="flex items-start justify-between gap-3"><Link to={cardPath(row)} className="font-bold">{row.name}</Link><MiniShelf row={row} /></div>
          <div className="text-sm"><MentorNeed action={row.mentor_action} studentId={row.student_id} /></div>
          <p className="text-xs text-ds-muted"><StudentNeed action={row.student_action} /></p>
        </li>)}</ul>
      </>}
    </QueryState>
  </div>
}
