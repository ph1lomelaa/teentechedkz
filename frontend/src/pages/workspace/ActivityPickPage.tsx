import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Activity, type ExperienceKey, type Participation } from '@/api/activities'
import { learnerTasksApi, emptyStep, type StepInput } from '@/api/learnerTasks'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryState } from '@/components/shared/QueryState'
import { FilterBar } from '@/components/activities/ActivityParts'
import { ActivityComposer } from '@/components/activities/ActivityComposer'
import { isExperienceKey, nearestActivityIntake, stepsFromTemplate } from '@/lib/activityUi'
import { EXPERIENCE_LABEL, formatDay } from '@/lib/portfolio/dictionary'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

type Mode = 'suggested' | 'selected'

/** Статус активности для этого ученика — чтобы не выдать то, что уже есть. */
function stateFor(activity: Activity, plan: Participation[]): string {
  const item = plan.find((p) => p.activity.id === activity.id)
  if (!item) return 'нет у ученика'
  if (item.decision === 'not_interested' || item.status === 'cancelled') return 'отказался'
  if (item.status === 'completed') return 'достижение'
  if (item.decision === 'suggested') return 'рекомендовано'
  return 'в плане'
}

/** Шаги для одного ученика: строкой, «Изменить» раскрывает строку на месте. Итог всегда последний. */
function StepRows({ steps, onChange }: { steps: StepInput[]; onChange: (steps: StepInput[]) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const edit = (index: number, patch: Partial<StepInput>) => onChange(steps.map((s, i) => i === index ? { ...s, ...patch } : s))
  return <ol className="divide-y divide-ds-line rounded-card border border-ds-line bg-ds-panel text-sm">
    {steps.map((step, index) => <li key={index} className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ds-line text-2xs font-bold text-ds-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold">{step.title || 'Без названия'}</p>
          <p className="text-xs text-ds-muted">{[step.due_date ? formatDay(step.due_date) : 'без срока', step.requires_evidence ? 'нужен файл' : null, step.requires_review ? 'проверяет ментор' : 'закроет сам'].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="text-xs font-semibold underline underline-offset-4" onClick={() => setOpen(open === index ? null : index)}>{open === index ? 'Готово' : 'Изменить'}</button>
      </div>
      {open === index && <div className="grid gap-3 pl-9 sm:grid-cols-2">
        <label className="block text-xs font-semibold sm:col-span-2">Что сделать<Input className="mt-1" value={step.title} maxLength={500} onChange={(e) => edit(index, { title: e.target.value })} /></label>
        <label className="block text-xs font-semibold">Срок<Input className="mt-1" type="date" value={step.due_date ?? ''} onChange={(e) => edit(index, { due_date: e.target.value || null })} /></label>
        <div className="flex flex-col justify-end gap-1.5 text-xs">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={step.requires_review} onChange={(e) => edit(index, { requires_review: e.target.checked })} />Проверяет ментор</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={step.requires_evidence} onChange={(e) => edit(index, { requires_evidence: e.target.checked })} />Нужен файл</label>
        </div>
        <button type="button" className="text-left text-xs font-semibold text-ds-danger underline underline-offset-4" onClick={() => { onChange(steps.filter((_, i) => i !== index)); setOpen(null) }}>Убрать шаг</button>
      </div>}
    </li>)}
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-ds-muted">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-ds-line text-2xs font-bold">{steps.length + 1}</span>
      <span><b className="text-ds-ink">Итог</b> · текст и файл · подтверждает ментор</span>
    </li>
    <li className="px-4 py-2.5"><button type="button" disabled={steps.length >= 100} className="text-sm font-semibold underline underline-offset-4" onClick={() => { onChange([...steps, emptyStep()]); setOpen(steps.length) }}>+ Шаг</button></li>
  </ol>
}

/**
 * Подбор для ученика: активность, способ выдачи и шаги на одном экране.
 * ?student — ученик, ?type — тип опыта, ?activity — выбранная активность,
 * ?participation — участие без плана: тогда сразу «Добавить в план» и шаги к нему.
 */
export function ActivityPickPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student') ?? ''
  const participationId = params.get('participation')
  const [type, setType] = useState<ExperienceKey | ''>(isExperienceKey(params.get('type')) ? params.get('type') as ExperienceKey : '')
  const [tab, setTab] = useState<'catalog' | 'new'>(params.get('tab') === 'new' ? 'new' : 'catalog')
  const [activityId, setActivityId] = useState(params.get('activity') ?? '')
  const [mode, setMode] = useState<Mode>(participationId ? 'selected' : 'suggested')
  const [reason, setReason] = useState('')
  const [decideBy, setDecideBy] = useState('')
  const [steps, setSteps] = useState<StepInput[]>([])
  const [touched, setTouched] = useState(false)
  const requestKey = useRef(crypto.randomUUID())
  // Ключ на каждый шаг: повтор после обрыва сети не создаст шаг дважды.
  const stepKeys = useRef<string[]>([])

  const students = useQuery({ queryKey: ['activities', 'students'], queryFn: activitiesApi.staffStudents })
  const plan = useQuery({ queryKey: ['activities', 'plan', studentId], queryFn: () => activitiesApi.plan(studentId), enabled: !!studentId })
  const catalog = useQuery({ queryKey: ['activities', 'catalog'], queryFn: activitiesApi.list })
  const name = students.data?.find((s) => s.id === studentId)?.name ?? 'Ученик'
  const short = name.split(/\s+/)[0]
  const list = useMemo(() => (catalog.data ?? []).filter((a) => a.publication === 'published' && (!type || (a.experience_type ?? 'other') === type)), [catalog.data, type])
  const activity = catalog.data?.find((a) => a.id === activityId)
  const intakes = useQuery({ queryKey: ['activities', 'intakes', activityId], queryFn: () => activitiesApi.intakes(activityId), enabled: !!activityId })
  const template = useQuery({ queryKey: ['activities', 'template', activityId], queryFn: () => activitiesApi.template(activityId), enabled: !!activityId })
  const intake = intakes.data ? nearestActivityIntake(intakes.data) : null
  useEffect(() => { if (template.data && !touched) setSteps(stepsFromTemplate(template.data, intake?.deadline)) }, [template.data, intake?.deadline, touched])
  useEffect(() => { setTouched(false) }, [activityId])
  const inCell = (plan.data ?? []).filter((p) => type && p.activity.experience_type === type && p.decision === 'selected' && p.status !== 'cancelled')
  const select = (id: string) => { setActivityId(id); const p = new URLSearchParams(params); p.set('activity', id); setParams(p, { replace: true }) }

  const submit = useMutation({
    mutationFn: async () => {
      const clean = steps.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim() }))
      if (participationId) {
        for (const [i, step] of clean.entries()) await learnerTasksApi.create({ ...step, creation_key: (stepKeys.current[i] ??= crypto.randomUUID()), student_id: studentId, activity_participation_id: participationId })
        return participationId
      }
      if (!intake) throw new Error('У активности нет открытого набора')
      const res = await activitiesApi.assign({ intake_id: intake.id, decision: mode, recommendation_note: reason.trim() || null, request_key: requestKey.current,
        ...(mode === 'suggested' && decideBy ? { decide_by: decideBy } : {}), recipients: [{ student_id: studentId, personal_deadline: null, steps: clean }] })
      const result = res.results[0]
      if (result?.status === 'error') throw new Error(result.message || 'Не удалось выдать активность')
      return result?.participation_id ?? null
    },
    // После выдачи — сразу в карточку ученика, на раскрытую активность: там можно дописать шаги и файлы.
    onSuccess: (pid) => { ['activities', 'portal', 'workspace'].forEach((k) => client.invalidateQueries({ queryKey: [k] })); navigate(`/workspace/students/${studentId}${pid ? `?p=${pid}` : ''}#portfolio`) },
  })

  const exit = `/workspace/students/${studentId}#portfolio`
  return <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 text-ds-ink sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Подбор для ученика</h1>
        <p className="mt-1 text-sm text-ds-muted">Ученик: {name}{type ? ` · ${EXPERIENCE_LABEL[type]}` : ''}</p>
        {type && <p className="mt-1 text-xs text-ds-muted">{inCell.length ? `Уже в плане: ${inCell.map((p) => p.activity.title).join(', ')}` : 'В ячейке пусто.'}</p>}
      </div>
      <Link to={exit} className="text-sm font-semibold underline underline-offset-4">Выйти из подбора</Link>
    </header>
    {!participationId && <FilterBar label="Источник" value={tab} onChange={setTab} options={[{ value: 'catalog', label: 'Из каталога', count: list.length }, { value: 'new', label: 'Новая активность' }]} />}
    {tab === 'new' && !participationId
      ? <section className="rounded-card border border-ds-line bg-ds-panel p-5">
          <ActivityComposer activity={null} catalog={catalog.data ?? []} editable presetType={type || undefined}
            onSaved={(saved) => { setTab('catalog'); setType((saved.experience_type ?? '') as ExperienceKey | ''); select(saved.id) }} onDuplicated={() => undefined} />
        </section>
      : <QueryState isLoading={catalog.isLoading || plan.isLoading} isError={catalog.isError || plan.isError} error={catalog.error || plan.error} onRetry={() => { catalog.refetch(); plan.refetch() }}>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section aria-label="Активности" className="space-y-2">
              <ul role="radiogroup" className="divide-y divide-ds-line overflow-hidden rounded-card border border-ds-line bg-ds-panel">
                {list.map((a) => { const state = stateFor(a, plan.data ?? []); return <li key={a.id}>
                  <label className={cn('flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-ds-panel2', activityId === a.id && 'bg-ds-panel2')}>
                    <input type="radio" name="activity" className="mt-1" checked={activityId === a.id} disabled={!!participationId} onChange={() => select(a.id)} />
                    <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{a.title}</span>
                      <span className={cn('block text-xs', state === 'нет у ученика' ? 'text-ds-muted' : 'font-semibold text-ds-ink')}>{state}</span></span>
                  </label>
                </li> })}
                {!list.length && <li className="px-4 py-6 text-sm text-ds-muted">Опубликованных активностей этого типа нет. Создайте новую.</li>}
              </ul>
              {type && <button type="button" className="text-xs font-semibold text-ds-muted underline underline-offset-4" onClick={() => setType('')}>Показать другие типы опыта</button>}
            </section>
            <section aria-label="Как выдать" className="space-y-4 rounded-card border border-ds-line bg-ds-panel p-5">
              {!activity ? <p className="text-sm text-ds-muted">Выберите активность слева.</p> : <>
                <h2 className="text-lg font-bold">{activity.title}</h2>
                {!participationId && <div className="space-y-2">
                  <FilterBar label="Как выдать" value={mode} onChange={setMode} options={[{ value: 'suggested', label: 'Рекомендовать' }, { value: 'selected', label: 'Сразу в план' }]} />
                  <p className="text-xs text-ds-muted">{mode === 'suggested'
                    ? `${short} увидит рекомендацию в «Сейчас» и решит до ${decideBy ? formatDay(decideBy) : 'даты ниже'}. Шаги появятся, когда ученик нажмёт «Добавить в план».`
                    : `Участие сразу появится у ученика, первый шаг попадёт в «Сейчас» и в «Задачи».`}</p>
                </div>}
                {!participationId && mode === 'suggested' && <label className="block text-sm font-semibold sm:w-1/2">Решить до<Input className="mt-1" type="date" value={decideBy} onChange={(e) => setDecideBy(e.target.value)} />
                  <span className="mt-1 block text-xs font-normal text-ds-muted">Пусто: за 10 дней до подачи.</span></label>}
                {!participationId && <label className="block text-sm font-semibold">Почему эта активность <span className="font-normal text-ds-muted">(увидит ученик)</span><Textarea className="mt-1" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} /></label>}
                <div className="space-y-2"><h3 className="text-sm font-bold">Шаги</h3><StepRows steps={steps} onChange={(next) => { setTouched(true); setSteps(next) }} /></div>
                {submit.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(submit.error)}</p>}
                <AppButton className="w-full sm:w-auto" disabled={submit.isPending || !studentId || steps.some((s) => !s.title.trim())} onClick={() => submit.mutate()}>
                  {participationId ? `Сохранить план · ${short}` : mode === 'suggested' ? `Рекомендовать · ${short}` : `Добавить в план · ${short}`}
                </AppButton>
              </>}
            </section>
          </div>
        </QueryState>}
  </div>
}
