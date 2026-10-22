import { AssignmentDialog } from './AssignmentDialog'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { activitiesApi, type Activity, type ExperienceKey } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/primitives/sheet'
import { QueryState } from '@/components/shared/QueryState'
import { nearestActivityIntake } from '@/lib/activityUi'
import { ActivityComposer } from './ActivityComposer'
import { ActivityDetailView } from './ActivityCards'
import { UnderlineTabs } from './ActivityParts'

type Tab = 'data' | 'recommend' | 'preview'
export function ActivityDrawer({ activity: initial, catalog, editable, initialStudent, initialTab = 'data', presetType, onClose }: {
  activity: Activity | null; catalog: Activity[]; editable: boolean; initialStudent?: string; initialTab?: Tab; presetType?: ExperienceKey; onClose: () => void
}) {
  const [activity, setActivity] = useState(initial)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [assigning, setAssigning] = useState(initialTab === 'recommend')
  const intakes = useQuery({ queryKey: ['activities', 'intakes', activity?.id], queryFn: () => activitiesApi.intakes(activity!.id), enabled: !!activity })
  const enriched = activity ? { ...activity, next_intake: nearestActivityIntake(intakes.data ?? []), intake_count: intakes.data?.length ?? 0 } : null
  // Выдача открывается поверх, когда известны наборы; без набора выдавать нечего.
  const dialogOpen = assigning && !!activity && !!intakes.data?.length
  return <><Sheet open={!dialogOpen} onOpenChange={open => { if (!open) onClose() }}><SheetContent className={tab === 'preview' ? 'sm:max-w-4xl' : 'sm:max-w-2xl'}>
    <header className="border-b border-ds-line px-5 pb-4 pt-6 pr-16"><p className="text-2xs font-bold uppercase tracking-caps text-ds-muted">Portfolio UP</p><SheetTitle className="mt-2 break-words text-xl font-bold">{activity?.title ?? 'Новая активность'}</SheetTitle><SheetDescription className="mt-1 text-xs text-ds-muted">{activity ? 'Карточка, сроки и типовые шаги — всё на одном экране' : 'Заполните главное — остальное можно дописать позже'}</SheetDescription></header>
    {activity && <div className="px-5 pt-4"><UnderlineTabs label="Карточка активности" value={tab} onChange={(next) => { setTab(next); if (next === 'recommend') setAssigning(true) }} tabs={[{ value: 'data', label: 'Активность' }, { value: 'recommend', label: 'Рекомендовать' }, { value: 'preview', label: 'Как увидит ученик' }]} /></div>}
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
      {tab === 'data' && <ActivityComposer key={activity?.id ?? 'new'} activity={activity} catalog={catalog} editable={editable} presetType={presetType}
        onSaved={(saved, next) => { setActivity(saved); if (next === 'recommend') { setTab('recommend'); setAssigning(true) } }}
        onDuplicated={(copy) => { setActivity(copy); setTab('data') }} />}
      {tab === 'recommend' && activity && <QueryState isLoading={intakes.isLoading} isError={intakes.isError} error={intakes.error} onRetry={() => intakes.refetch()}>
        {intakes.data?.length
          ? <div className="space-y-3"><p className="text-sm text-ds-muted">Выберите учеников — типовые шаги подставятся с датами от дедлайна набора.</p><AppButton onClick={() => setAssigning(true)}>Выдать активность</AppButton></div>
          : <div className="space-y-3 rounded-panel border border-ds-accent-dim p-4 text-sm"><p className="font-semibold">Сначала добавьте набор</p><p className="text-ds-muted">Ученик выбирает конкретный сезон со сроками. Добавьте его на вкладке «Активность».</p><AppButton size="sm" variant="subtle" onClick={() => setTab('data')}>К срокам</AppButton></div>}
      </QueryState>}
      {tab === 'preview' && enriched && <QueryState isLoading={intakes.isLoading} isError={intakes.isError} error={intakes.error} onRetry={() => intakes.refetch()}><ActivityDetailView activity={enriched} intakes={intakes.data ?? []} aside={<div className="rounded-card border border-ds-line bg-ds-panel p-5 text-sm text-ds-muted">Так карточку увидит ученик. Добавление в план ещё не означает регистрацию у организатора.</div>} /></QueryState>}
    </div>
  </SheetContent></Sheet>
    {dialogOpen && <AssignmentDialog activity={activity!} intakes={intakes.data!} initialStudent={initialStudent} onClose={() => setAssigning(false)} />}
  </>
}
