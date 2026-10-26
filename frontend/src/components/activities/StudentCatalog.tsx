import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Compass, Search } from 'lucide-react'
import { activitiesApi, type ExperienceKey } from '@/api/activities'
import { AppButton, EmptyState } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { EXPERIENCE_TYPES, directionCounts, isExperienceKey } from '@/lib/activityUi'
import { ActivityCatalogCard, planStateOf } from './ActivityCards'
import { FilterSelect } from './ActivityParts'
import { participationByActivity, useAddToPlan, useMyPlan } from './useStudentActivities'

export function StudentCatalog() {
  const navigate = useNavigate()
  const catalog = useQuery({ queryKey: ['activities', 'catalog'], queryFn: activitiesApi.list })
  const plan = useMyPlan()
  const add = useAddToPlan()
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('')
  const [price, setPrice] = useState<'free' | 'paid' | ''>('')
  const [params, setParams] = useSearchParams()
  const type = isExperienceKey(params.get('type')) ? params.get('type') as ExperienceKey : ''
  const setType = (next: ExperienceKey | '') => { const p = new URLSearchParams(params); if (next) p.set('type', next); else p.delete('type'); setParams(p, { replace: true }) }
  const byActivity = useMemo(() => participationByActivity(plan.data), [plan.data])
  const all = catalog.data ?? []
  const directions = directionCounts(all)
  const needle = search.trim().toLocaleLowerCase()
  const visible = all.filter((a) => (!direction || a.direction === direction)
    && (!type || (a.experience_type ?? 'other') === type)
    && (!price || a.next_intake?.cost_state === price)
    && (!needle || `${a.title} ${a.organizer ?? ''} ${a.country ?? ''} ${a.kind ?? ''}`.toLocaleLowerCase().includes(needle)))
  const open = (activityId: string) => navigate(`/portal/activities/${activityId}`)

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" aria-hidden />
        <Input aria-label="Поиск активностей" placeholder="Название, организатор или страна" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>
      <FilterSelect label="Направление" value={direction} onChange={setDirection} options={directions.map((d) => ({ value: d.value, label: d.label, count: d.count }))} />
      <FilterSelect label="Тип опыта" value={type} onChange={setType}
        options={EXPERIENCE_TYPES.map((t) => ({ value: t.key, label: t.short, count: all.filter((a) => (a.experience_type ?? 'other') === t.key).length })).filter((o) => o.count)} />
      <FilterSelect label="Цена" value={price} onChange={setPrice}
        options={[{ value: 'free' as const, label: 'Бесплатно', count: all.filter((a) => a.next_intake?.cost_state === 'free').length }, { value: 'paid' as const, label: 'Платно', count: all.filter((a) => a.next_intake?.cost_state === 'paid').length }].filter((o) => o.count)} />
    </div>
    <QueryState isLoading={catalog.isLoading || plan.isLoading} isError={catalog.isError || plan.isError} error={catalog.error || plan.error} onRetry={() => { catalog.refetch(); plan.refetch() }}>
      {!visible.length
        ? <EmptyState icon={<Compass className="h-6 w-6" />}
            title={all.length ? 'Ничего не нашлось' : 'Каталог скоро наполнится'}
            description={all.length ? 'Измените поиск или снимите фильтры.' : 'Здесь появятся проверенные возможности с открытым набором.'}
            action={all.length ? <AppButton size="sm" variant="subtle" onClick={() => { setSearch(''); setDirection(''); setPrice(''); setType('') }}>Сбросить фильтры</AppButton> : undefined} />
        : <div className="grid gap-4 pt-1 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((activity) => {
              const existing = byActivity.get(activity.id)
              const matching = existing?.decision === 'suggested' || existing?.intake_id === activity.next_intake?.id ? existing : undefined
              return <ActivityCatalogCard key={activity.id} activity={activity} planState={existing?.decision === 'not_interested' && !matching ? 'none' : planStateOf(existing)} unavailableReason={matching?.status === 'cancelled' ? 'Участие в этом наборе отменено — обсудите новый набор с ментором' : undefined}
                onOpen={() => open(activity.id)} adding={add.isPending || plan.isFetching || plan.isError}
                onAdd={() => activity.next_intake && add.mutate({ intakeId: matching?.intake_id ?? activity.next_intake.id, existing: matching })} />
            })}
          </div>}
    </QueryState>
  </div>
}
