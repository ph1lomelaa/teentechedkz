import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { activitiesApi, type BoardCard, type BoardStage, type ExperienceKey } from '@/api/activities'
import { Avatar } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { cn } from '@/lib/utils'
import { EXPERIENCE_LABEL, EXPERIENCE_TYPES, PARTICIPATION_STAGE, formatDay, formatDue } from '@/lib/portfolio/dictionary'
import { FilterBar, FilterSelect } from './ActivityParts'

const STAGES: BoardStage[] = ['recommendation', 'in_work', 'result_review', 'achievement']
const participationPath = (id: string) => `/workspace/activities/participations/${id}`

/** Карточка активности: тип, срок подачи, аватары учеников; раскрывается списком. */
function Card({ card }: { card: BoardCard }) {
  const [open, setOpen] = useState(false)
  const shown = card.students.slice(0, 5)
  return <article className="rounded-card border border-ds-line bg-ds-panel p-3">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="block w-full text-left">
      <h3 className="break-words text-sm font-bold leading-snug">{card.title}</h3>
      <p className="mt-1 text-xs text-ds-muted">{[EXPERIENCE_LABEL[card.experience_type], card.submit_deadline ? `подача до ${formatDay(card.submit_deadline)}` : null].filter(Boolean).join(' · ')}</p>
    </button>
    <ul className="mt-2.5 flex flex-wrap items-center gap-1">
      {shown.map((s) => <li key={s.participation_id} className="relative">
        <Link to={participationPath(s.participation_id)} title={s.name ?? 'Ученик'} aria-label={`План: ${s.name ?? 'ученик'}`}><Avatar name={s.name || 'Ученик'} size={28} /></Link>
        {(s.needs_me || s.overdue_days > 0) && <span aria-hidden className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-ds-panel', s.overdue_days > 0 ? 'bg-ds-danger' : 'bg-ds-accent')} />}
      </li>)}
      {card.students.length > 5 && <li className="text-xs font-semibold text-ds-muted">+{card.students.length - 5}</li>}
    </ul>
    {open && <ul className="mt-3 divide-y divide-ds-line border-t border-ds-line text-xs">
      {card.students.map((s) => <li key={s.participation_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
        <Link to={participationPath(s.participation_id)} className="font-semibold hover:underline">{s.name ?? 'Ученик'}</Link>
        {s.step_total > 0 && <span className="text-ds-muted">Шаг {s.step_index || s.step_total} из {s.step_total}</span>}
        {s.due && <span className={s.overdue_days ? 'font-semibold text-ds-danger' : 'text-ds-muted'}>{formatDue(s.due)}</span>}
        {s.needs_me && <span className="ml-auto font-semibold text-ds-accentText">нужно от меня</span>}
      </li>)}
    </ul>}
  </article>
}

/** Доска по активностям: стадии колонками, в карточке активности — её ученики. */
export function ActivityBoard() {
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ExperienceKey | ''>('')
  const [stage, setStage] = useState<BoardStage>('in_work')
  const query = useQuery({ queryKey: ['activities', 'board', search, type], queryFn: () => activitiesApi.board({ q: search, experience_type: type }) })
  const columns = query.data?.columns ?? []
  const column = (key: BoardStage) => columns.find((c) => c.key === key)?.items ?? []
  const count = (key: BoardStage) => column(key).reduce((n, card) => n + card.students.length, 0)
  const list = (key: BoardStage) => column(key).length
    ? <div className="space-y-2">{column(key).map((card) => <Card key={card.activity_id} card={card} />)}</div>
    : <p className="rounded-card border border-dashed border-ds-line p-4 text-xs text-ds-muted">Пусто</p>
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-full sm:basis-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" aria-hidden /><Input aria-label="Поиск по доске" className="pl-10" placeholder="Активность или ученик" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <FilterSelect label="Тип опыта" value={type} onChange={setType} options={EXPERIENCE_TYPES.filter((t) => t.key !== 'other').map((t) => ({ value: t.key, label: t.short }))} />
    </div>
    <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
      <div className="md:hidden space-y-3">
        <FilterBar label="Стадия" value={stage} onChange={setStage} options={STAGES.map((key) => ({ value: key, label: PARTICIPATION_STAGE[key].label, count: count(key) || undefined }))} />
        {list(stage)}
      </div>
      <div className="hidden gap-3 md:grid md:grid-cols-4">
        {STAGES.map((key) => <section key={key} aria-label={PARTICIPATION_STAGE[key].label} className="min-w-0 space-y-2">
          <h2 className="flex items-baseline gap-1.5 text-sm font-bold">{PARTICIPATION_STAGE[key].label}{count(key) > 0 && <span className="text-xs font-normal text-ds-muted">{count(key)}</span>}</h2>
          {list(key)}
        </section>)}
      </div>
      {!!query.data?.declined && <p className="text-xs text-ds-muted">Отказались · {query.data.declined}</p>}
    </QueryState>
  </div>
}
