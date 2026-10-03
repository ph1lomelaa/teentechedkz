import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Compass, Search } from 'lucide-react'
import { activitiesApi, type Participation } from '@/api/activities'
import { AppButton, Avatar, EmptyState } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { directionCounts } from '@/lib/activityUi'
import { ActivityCatalogCard, planStateOf } from './ActivityCards'
import { DirectionBadge, FilterChip } from './ActivityParts'
import { participationByActivity, useAddToPlan, useDecline, useMyPlan } from './useStudentActivities'

/** Один крупный блок рекомендаций; несколько — листаются стрелками. */
function RecommendationBlock({ items, onOpen }: { items: Participation[]; onOpen: (item: Participation) => void }) {
  const [index, setIndex] = useState(0)
  const add = useAddToPlan()
  const decline = useDecline()
  const item = items[Math.min(index, items.length - 1)]
  const busy = add.isPending || decline.isPending
  const mentor = item.selected_by_name || item.mentor_name
  return <section aria-labelledby="recommended-title" className="rounded-card border border-ds-accent-dim bg-ds-accent/[0.07] p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={mentor || 'Ментор'} size={36} />
        <div className="min-w-0">
          <p id="recommended-title" className="text-2xs font-bold uppercase tracking-caps text-ds-accentText">Ментор рекомендует тебе</p>
          <p className="truncate text-sm text-ds-muted">{mentor || 'Команда Portfolio UP'}</p>
        </div>
      </div>
      {items.length > 1 && <div className="flex items-center gap-1 text-xs text-ds-muted">
        <button type="button" aria-label="Предыдущая рекомендация" disabled={index === 0} onClick={() => setIndex(index - 1)} className="grid h-8 w-8 place-items-center rounded-ctl hover:bg-ds-panel2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <span aria-live="polite">{Math.min(index, items.length - 1) + 1} из {items.length}</span>
        <button type="button" aria-label="Следующая рекомендация" disabled={index >= items.length - 1} onClick={() => setIndex(index + 1)} className="grid h-8 w-8 place-items-center rounded-ctl hover:bg-ds-panel2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </div>}
    </div>
    <div className="mt-4 min-w-0">
      <DirectionBadge direction={item.activity.direction} kind={item.activity.kind} />
      <h2 title={item.activity.title} className="mt-2 line-clamp-3 break-words text-xl font-bold leading-snug">{item.activity.title}</h2>
      {item.recommendation_note && <blockquote className="mt-2 border-l-2 border-ds-accent-dim pl-3 text-sm italic leading-relaxed">«{item.recommendation_note}»</blockquote>}
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <AppButton size="sm" disabled={busy} onClick={() => add.mutate({ intakeId: item.intake_id, existing: item })}>Добавить в план</AppButton>
      <AppButton size="sm" variant="subtle" disabled={busy} onClick={() => decline.mutate(item)}>Не интересно</AppButton>
      <button type="button" onClick={() => onOpen(item)} className="px-2 text-sm font-semibold text-ds-ink underline underline-offset-4 hover:text-ds-accentText">Подробнее</button>
    </div>
  </section>
}

export function StudentCatalog() {
  const navigate = useNavigate()
  const catalog = useQuery({ queryKey: ['activities', 'catalog'], queryFn: activitiesApi.list })
  const plan = useMyPlan()
  const add = useAddToPlan()
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)
  const byActivity = useMemo(() => participationByActivity(plan.data), [plan.data])
  const suggestions = (plan.data ?? []).filter((item) => item.status !== 'cancelled' && item.status !== 'completed' && item.activity.publication !== 'archived' && item.decision === 'suggested')
  const all = catalog.data ?? []
  const directions = directionCounts(all)
  const needle = search.trim().toLocaleLowerCase()
  const visible = all.filter((a) => (!direction || a.direction === direction)
    && (!freeOnly || a.next_intake?.cost_state === 'free')
    && (!needle || `${a.title} ${a.organizer ?? ''} ${a.country ?? ''} ${a.kind ?? ''}`.toLocaleLowerCase().includes(needle)))
  const open = (activityId: string) => navigate(`/portal/activities/${activityId}`)

  return <div className="space-y-6">
    {suggestions.length > 0 && <RecommendationBlock items={suggestions} onOpen={(item) => open(item.activity.id)} />}
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" aria-hidden />
        <Input aria-label="Поиск активностей" placeholder="Название, организатор или страна" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Направления">
        <FilterChip active={!direction} onClick={() => setDirection('')} count={all.length}>Все</FilterChip>
        {directions.map((d) => <FilterChip key={d.value} active={direction === d.value} onClick={() => setDirection(direction === d.value ? '' : d.value)} count={d.count}>{d.label}</FilterChip>)}
        <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-ds-line" />
        <FilterChip active={freeOnly} onClick={() => setFreeOnly(!freeOnly)} count={all.filter((a) => a.next_intake?.cost_state === 'free').length}>Бесплатно</FilterChip>
      </div>
    </div>
    <QueryState isLoading={catalog.isLoading || plan.isLoading} isError={catalog.isError || plan.isError} error={catalog.error || plan.error} onRetry={() => { catalog.refetch(); plan.refetch() }}>
      {!visible.length
        ? <EmptyState icon={<Compass className="h-6 w-6" />}
            title={all.length ? 'Ничего не нашлось' : 'Каталог скоро наполнится'}
            description={all.length ? 'Измените поиск или снимите фильтры.' : 'Здесь появятся проверенные возможности с открытым набором.'}
            action={all.length ? <AppButton size="sm" variant="subtle" onClick={() => { setSearch(''); setDirection(''); setFreeOnly(false) }}>Сбросить фильтры</AppButton> : undefined} />
        : <div className="grid gap-4 pt-1 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((activity) => {
              const existing = byActivity.get(activity.id)
              const matching = existing?.decision === 'suggested' || existing?.intake_id === activity.next_intake?.id ? existing : undefined
              return <ActivityCatalogCard key={activity.id} activity={activity} planState={planStateOf(existing)} unavailableReason={matching?.status === 'cancelled' ? 'Участие в этом наборе отменено — обсудите новый набор с ментором' : undefined}
                onOpen={() => open(activity.id)} adding={add.isPending || plan.isFetching || plan.isError}
                onAdd={() => activity.next_intake && add.mutate({ intakeId: matching?.intake_id ?? activity.next_intake.id, existing: matching })} />
            })}
          </div>}
    </QueryState>
  </div>
}
