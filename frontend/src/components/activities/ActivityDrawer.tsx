import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Activity, type Intake, type RecommendInput } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/primitives/sheet'
import { QueryState } from '@/components/shared/QueryState'
import { getErrorMessage } from '@/lib/errorMessage'
import { intakeCost, intakeWhen, nearestActivityIntake } from '@/lib/activityUi'
import { ActivityDataForm } from './ActivityDataForm'
import { IntakeEditor } from './IntakeEditor'
import { ActivityDetailView } from './ActivityCards'
import { UnderlineTabs } from './ActivityParts'

type Tab = 'data' | 'recommend' | 'preview'
function RecommendForm({ activity, intakes, initialStudent }: { activity: Activity; intakes: Intake[]; initialStudent?: string }) {
  const [students, setStudents] = useState<string[]>(initialStudent ? [initialStudent] : [])
  const [intakeId, setIntakeId] = useState(intakes[0]?.id ?? '')
  const [decision, setDecision] = useState<RecommendInput['decision']>('suggested')
  const [note, setNote] = useState('')
  const [deadline, setDeadline] = useState('')
  const [done, setDone] = useState(false)
  const client = useQueryClient()
  const directory = useQuery({ queryKey: ['activities', 'staff-students'], queryFn: activitiesApi.staffStudents })
  const existing = useQuery({ queryKey: ['activities', 'activity-participations', activity.id], queryFn: async () => {
    const all = []
    for (let offset = 0; ; offset += 500) { const page = await activitiesApi.overview({ activity_id: activity.id, offset, limit: 500, view: 'all' }); all.push(...page.items); if (all.length >= page.total) break }
    const closed = await activitiesApi.overview({ activity_id: activity.id, limit: 500, view: 'closed' })
    return [...all, ...closed.items]
  } })
  const duplicate = new Set((existing.data ?? []).filter(p => p.intake_id === intakeId).map(p => p.student_id))
  const targets = students.filter(id => !duplicate.has(id))
  const save = useMutation({ mutationFn: async () => {
    // Sequential writes: on partial failure a retry is safe because backend preserves existing participation.
    for (const id of targets) await activitiesApi.recommend(id, { intake_id: intakeId, decision, recommendation_note: note.trim() || null, personal_deadline: deadline || null })
  }, onSuccess: () => { setDone(true); setStudents([]); client.invalidateQueries({ queryKey: ['activities'] }) } })
  const intake = intakes.find(i => i.id === intakeId)
  const intakeClosed = !!intake?.deadline && intake.deadline < new Date().toLocaleDateString('en-CA')
  return <div className="space-y-5">
    <p className="text-sm text-ds-muted">Предложите активность ученику или сразу добавьте в его план. Регистрация у организатора выполняется отдельно.</p>
    <label className="block text-sm font-semibold">Набор<select aria-label="Набор для рекомендации" className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={intakeId} onChange={e => { setIntakeId(e.target.value); setDone(false) }}>{!intakes.length && <option value="">Сначала добавьте набор</option>}{intakes.map(i => <option key={i.id} value={i.id}>{i.label} · {intakeWhen(i)}</option>)}</select></label>
    <QueryState isLoading={directory.isLoading || existing.isLoading} isError={directory.isError || existing.isError} error={directory.error || existing.error} onRetry={() => { directory.refetch(); existing.refetch() }}>
      <fieldset disabled={save.isPending} className="space-y-2"><legend className="mb-2 text-sm font-semibold">Ученики</legend>
        {!directory.data?.length && <p className="text-sm text-ds-muted">Нет доступных учеников. Проверьте действующие назначения.</p>}
        <div className="max-h-56 overflow-y-auto rounded-panel border border-ds-line">{directory.data?.map(s => <label key={s.id} className="flex items-center gap-3 border-b border-ds-line p-3 text-sm last:border-0"><input type="checkbox" checked={students.includes(s.id)} disabled={duplicate.has(s.id)} onChange={e => { setStudents(e.target.checked ? [...students, s.id] : students.filter(id => id !== s.id)); setDone(false) }} /><span className="min-w-0 flex-1 break-words">{s.name}</span>{duplicate.has(s.id) && <span className="text-xs text-ds-muted">Участие уже есть</span>}</label>)}</div>
      </fieldset>
    </QueryState>
    <label className="block text-sm font-semibold">Причина · увидит ученик<Textarea maxLength={2000} className="mt-2" value={note} onChange={e => setNote(e.target.value)} placeholder="Почему эта активность подходит ученику" /></label>
    <label className="block text-sm font-semibold">Способ назначения<select aria-label="Способ назначения" className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={decision} onChange={e => setDecision(e.target.value as RecommendInput['decision'])}><option value="suggested">Предложить — ученик решит</option><option value="selected">Сразу в план</option></select></label>
    <label className="block text-sm font-semibold">Личный срок<Input className="mt-2" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
    <p className="text-xs text-ds-muted">Срок организатора: {intake ? intakeWhen(intake) : 'Дата неизвестна'}. Личный срок хранится отдельно.</p>
    {intakeClosed && <p className="text-sm text-ds-danger">Набор закрыт — выберите другой набор.</p>}
    {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)} Можно повторить: дубли не создадутся.</p>}
    {done && <p role="status" className="text-sm text-ds-good">Активность добавлена ученикам.</p>}
    <AppButton disabled={save.isPending || !targets.length || !intakeId || existing.isFetching || existing.isError || activity.publication === 'archived' || intakeClosed} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : decision === 'suggested' ? 'Рекомендовать ученикам' : 'Добавить в план'}{targets.length > 0 ? ` · ${targets.length}` : ''}</AppButton>
  </div>
}

export function ActivityDrawer({ activity: initial, catalog, editable, initialStudent, initialTab = 'data', onClose }: { activity: Activity | null; catalog: Activity[]; editable: boolean; initialStudent?: string; initialTab?: Tab; onClose: () => void }) {
  const [activity, setActivity] = useState(initial)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [intakeEdit, setIntakeEdit] = useState<Intake | 'new' | null>(null)
  const intakes = useQuery({ queryKey: ['activities', 'intakes', activity?.id], queryFn: () => activitiesApi.intakes(activity!.id), enabled: !!activity })
  const enriched = activity ? { ...activity, next_intake: nearestActivityIntake(intakes.data ?? []), intake_count: intakes.data?.length ?? 0 } : null
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}><SheetContent className={tab === 'preview' ? 'sm:max-w-4xl' : ''}>
    <header className="border-b border-ds-line px-5 pb-4 pt-6 pr-16"><p className="text-2xs font-bold uppercase tracking-caps text-ds-muted">Portfolio UP</p><SheetTitle className="mt-2 break-words text-xl font-bold">{activity?.title ?? 'Новая активность'}</SheetTitle><SheetDescription className="mt-1 text-xs text-ds-muted">Данные каталога и личные рекомендации ученикам</SheetDescription></header>
    {activity && <div className="px-5 pt-4"><UnderlineTabs label="Карточка активности" value={tab} onChange={setTab} tabs={[{ value: 'data', label: 'Данные' }, { value: 'recommend', label: 'Рекомендовать' }, { value: 'preview', label: 'Превью' }]} /></div>}
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {tab === 'data' && <div className="space-y-7"><ActivityDataForm key={activity?.id ?? 'new'} activity={activity ?? undefined} catalog={catalog} editable={editable} onSaved={a => setActivity(a)} />
        {activity && <section className="space-y-3"><h3 className="font-bold">Наборы и сроки</h3><QueryState isLoading={intakes.isLoading} isError={intakes.isError} error={intakes.error} onRetry={() => intakes.refetch()}>{intakes.data?.map(i => <div key={i.id} className="rounded-panel border border-ds-line bg-ds-panel p-4"><p className="font-semibold">{i.label}</p><p className="mt-1 text-sm text-ds-muted">{intakeWhen(i)} · {intakeCost(i)}</p>{editable && <button className="mt-2 text-sm underline" onClick={() => setIntakeEdit(i)}>Редактировать набор</button>}</div>)}{!intakes.data?.length && <p className="text-sm text-ds-muted">Наборов пока нет.</p>}</QueryState>{intakeEdit ? <IntakeEditor key={intakeEdit === 'new' ? 'new' : intakeEdit.id} activityId={activity.id} intake={intakeEdit === 'new' ? undefined : intakeEdit} onClose={() => setIntakeEdit(null)} /> : editable && <AppButton variant="subtle" onClick={() => setIntakeEdit('new')}>+ Добавить набор</AppButton>}</section>}
      </div>}
      {tab === 'recommend' && activity && <QueryState isLoading={intakes.isLoading} isError={intakes.isError} error={intakes.error} onRetry={() => intakes.refetch()}><RecommendForm activity={activity} intakes={intakes.data ?? []} initialStudent={initialStudent} /></QueryState>}
      {tab === 'preview' && enriched && <QueryState isLoading={intakes.isLoading} isError={intakes.isError} error={intakes.error} onRetry={() => intakes.refetch()}><ActivityDetailView activity={enriched} intakes={intakes.data ?? []} aside={<div className="rounded-card border border-ds-line bg-ds-panel p-5 text-sm text-ds-muted">Так карточку увидит ученик. Добавление в план ещё не означает регистрацию у организатора.</div>} /></QueryState>}
    </div>
  </SheetContent></Sheet>
}
