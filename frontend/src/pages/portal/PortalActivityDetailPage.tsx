import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, Check, MessageCircle } from 'lucide-react'
import { activitiesApi } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { ActivityDetailView } from '@/components/activities/ActivityCards'
import { participationByActivity, useAddToPlan, useMyPlan } from '@/components/activities/useStudentActivities'
import { intakeCost, intakeWhen, nearestActivityIntake } from '@/lib/activityUi'
import { formatDate } from '@/lib/utils'

export function PortalActivityDetailPage() {
  const { activityId = '' } = useParams()
  const activity = useQuery({ queryKey: ['activities', 'detail', activityId], queryFn: () => activitiesApi.get(activityId) })
  const intakes = useQuery({ queryKey: ['activities', 'intakes', activityId], queryFn: () => activitiesApi.intakes(activityId) })
  const plan = useMyPlan()
  const add = useAddToPlan()
  const existing = participationByActivity(plan.data).get(activityId)
  const today = new Date().toLocaleDateString('en-CA')
  const available = (intakes.data ?? []).filter(i => !i.deadline || i.deadline >= today).sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
  const selected = existing?.decision === 'selected' && existing.status !== 'cancelled'
  const a = activity.data ? { ...activity.data, next_intake: nearestActivityIntake(available, today), intake_count: intakes.data?.length ?? 0 } : null
  return <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-ds-ink sm:px-6">
    <Link to="/portal/activities?view=catalog" className="inline-flex items-center gap-2 text-sm text-ds-muted hover:text-ds-ink"><ArrowLeft className="h-4 w-4" />Каталог активностей</Link>
    <QueryState isLoading={activity.isLoading || intakes.isLoading || plan.isLoading} isError={activity.isError || intakes.isError || plan.isError} error={activity.error || intakes.error || plan.error} onRetry={() => { activity.refetch(); intakes.refetch(); plan.refetch() }}>
      {a && <ActivityDetailView activity={a} intakes={intakes.data ?? []} aside={<div className="space-y-4 rounded-card border border-ds-line bg-ds-panel p-5">
        {a.publication === 'archived' && <p className="text-sm font-bold text-ds-muted">Активность в архиве. Новые участия закрыты.</p>}
        {selected ? <Link to="/portal/activities" className="flex items-center justify-center gap-2 rounded-ctl bg-ds-good/15 p-3 text-sm font-bold text-ds-good"><Check className="h-4 w-4" />В моём плане</Link> : <div className="space-y-2">{available.map(i => <div key={i.id} className="space-y-2"><p className="text-xs text-ds-muted">{intakeWhen(i)} · {intakeCost(i)}</p><AppButton className="w-full" disabled={add.isPending || plan.isFetching || a.publication === 'archived' || (existing?.status === 'cancelled' && existing.intake_id === i.id) || (a.publication === 'draft' && existing?.intake_id !== i.id)} onClick={() => add.mutate({ intakeId: i.id, existing: existing?.intake_id === i.id ? existing : undefined })}>Добавить в мой план{available.length > 1 ? ` · ${i.label}` : ''}</AppButton></div>)}{!available.length && <p className="text-sm text-ds-muted">{intakes.data?.length ? 'Набор закрыт. Ждём следующий.' : 'Дата неизвестна. Наборы пока не добавлены.'}</p>}</div>}
        {existing?.status === 'cancelled' && <p className="text-xs text-ds-muted">Участие отменено. Обсудите новый набор с ментором.</p>}
        <Link to="/portal/chat" className="flex items-center justify-center gap-2 rounded-ctl border border-ds-line p-3 text-sm font-semibold"><MessageCircle className="h-4 w-4" />Задать вопрос ментору</Link>
        <p className="text-xs leading-relaxed text-ds-muted">Добавление в план — ещё не регистрация у организатора. Ментор поможет разобраться с условиями и шагами.</p>
        {a.source_url ? <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-bold underline underline-offset-4">Официальный сайт <ArrowUpRight className="h-4 w-4" /></a> : <p className="text-xs text-ds-muted">Ссылка организатора уточняется</p>}
        <p className="border-t border-ds-line pt-3 text-xs text-ds-muted">{a.conditions_checked_at ? `Условия проверены ${formatDate(a.conditions_checked_at)}` : 'Дата проверки условий пока не указана'}</p>
      </div>} />}
    </QueryState>
  </div>
}
