import { learnerTasksApi } from '@/api/learnerTasks'
import { useWsEvent } from '@/lib/ws'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, ArrowDown, Copy, MessageCircle } from 'lucide-react'
import { activitiesApi, type Participation } from '@/api/activities'
import type { RoadmapTask } from '@/api/roadmap'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryState } from '@/components/shared/QueryState'
import { LearnerStep } from '@/components/activities/LearnerStep'
import { ResultStep } from '@/components/activities/ResultStep'
import { AddParticipationSteps } from '@/components/activities/AssignmentDialog'
import { StatusTag } from '@/components/activities/StatusTag'
import { getErrorMessage } from '@/lib/errorMessage'
import { EXPERIENCE_LABEL, intakeLabel, participationStatus } from '@/lib/activityUi'
import { formatDay, formatDue, type NeedWho } from '@/lib/portfolio/dictionary'
import { NeedLine } from '@/components/activities/shared/NeedLine'
import { ProgressSegments } from '@/components/activities/ActivityParts'

export function ParticipationDetailPage() {
  const { participationId = '' } = useParams()
  const { user, can } = useAuth()
  const own = user?.role === 'student'
  const canManage = !own && can('portfolio', 'manage')
  const client = useQueryClient()
  const itemQuery = useQuery({ queryKey: ['activities', 'participation', participationId], queryFn: () => activitiesApi.participation(participationId), refetchInterval: 30000 })
  const tasks = useQuery({ queryKey: ['activities', 'tasks', participationId], queryFn: () => activitiesApi.tasks(participationId) })
  const mentors = useQuery({ queryKey: ['activities', 'mentors', participationId], queryFn: () => activitiesApi.mentors(participationId), enabled: canManage })
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [goal, setGoal] = useState<string | null>(null)
  const [mentorId, setMentorId] = useState<string | null>(null)
  const [due, setDue] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const refresh = () => { ['activities', 'portal', 'workspace', 'student-tasks'].forEach(k => client.invalidateQueries({ queryKey: [k] })); setSettings(false); setDeclining(false) }
  useWsEvent('portfolio.updated', () => client.invalidateQueries({ queryKey: ['activities'] }))
  useWsEvent('roadmap.updated', () => client.invalidateQueries({ queryKey: ['activities'] }))
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh })
  const item = itemQuery.data
  const closed = !item || ['completed', 'cancelled'].includes(item.status) || item.decision === 'not_interested'
  const pendingResult = item?.result_review_status === 'pending'
  const allRequiredDone = tasks.data?.every(t => t.priority !== 'required' || t.status === 'done') ?? false
  // Открыт шаг из ссылки (#step-…), иначе — текущий шаг плана.
  const { hash } = useLocation()
  // Ментору сразу раскрыт шаг на проверке, ученику — его следующий шаг (правки идут первыми).
  const pendingStep = tasks.data?.find((t) => t.review_status === 'pending' && t.status !== 'done')?.id
  const openStep = hash.startsWith('#step-') ? hash.slice(6) : own ? item?.steps?.next?.id : pendingStep ?? item?.steps?.next?.id
  useEffect(() => {
    if (!hash || !tasks.data) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, tasks.data])
  const moveStep = (index: number, delta: number) => {
    const order = (tasks.data ?? []).map(t => t.id)
    ;[order[index], order[index + delta]] = [order[index + delta], order[index]]
    action.mutate(() => activitiesApi.reorderSteps(participationId, order))
  }
  const submissions = useQuery({ queryKey: ['activities', 'submissions', participationId], queryFn: () => activitiesApi.submissions(participationId), enabled: !!item && item.decision === 'selected' })
  const [editMode, setEditMode] = useState(false)
  const back = own ? '/portal/activities' : item ? `/workspace/students/${item.student_id}#portfolio` : '/workspace/activities'
  const status = item ? participationStatus(item) : ''
  const steps = tasks.data ?? []
  const lastStepDue = steps.map((t) => t.due_date).filter((d): d is string => Boolean(d)).sort().at(-1)
  const need = item && needLine(item, steps, own)
  const terms = item && <Terms item={item} lastStepDue={lastStepDue} />
  const why = item && <Why item={item} own={own} />
  return <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 text-ds-ink sm:px-6">
    <Link className="inline-flex items-center gap-2 text-sm font-semibold text-ds-muted hover:text-ds-ink" to={back}><ArrowLeft className="h-4 w-4" />{own ? 'Портфолио' : `Портфолио · ${item?.student_name ?? 'ученик'}`}</Link>
    <QueryState isLoading={itemQuery.isLoading} isError={itemQuery.isError} error={itemQuery.error} onRetry={() => itemQuery.refetch()}>
      {item && <>
        <header className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-5 sm:p-6">
          <p className="text-xs text-ds-muted">{EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']} · участие{!own && ` · ${item.student_name || 'Ученик'}`}</p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 break-words text-2xl font-bold sm:text-3xl">{item.activity.title}</h1>
            <div className="flex items-center gap-2">
              <StatusTag tone={item.status === 'completed' ? 'good' : pendingResult ? 'info' : 'neutral'}>{status}</StatusTag>
              {canManage && !closed && <AppButton size="sm" variant="subtle" aria-pressed={editMode} onClick={() => setEditMode(!editMode)}>{editMode ? 'Готово' : 'Изменить план'}</AppButton>}
            </div>
          </div>
          {!!item.steps?.total && <div className="flex max-w-md items-center gap-1"><ProgressSegments steps={item.steps} className="flex-1" /><span aria-hidden title="Итог" className={`h-1.5 w-8 rounded-full border border-dashed ${item.status === 'completed' ? 'border-ds-good bg-ds-good' : pendingResult ? 'border-ds-info bg-ds-info/40' : 'border-ds-muted2'}`} /></div>}
          {need && <NeedLine who={need.who}>{need.text}</NeedLine>}
        </header>
        {own && item.decision === 'suggested' && !closed && <section className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-5">
          <p className="font-semibold">Рекомендация ментора{item.decide_by ? ` · решите до ${formatDay(item.decide_by)}` : ''}</p>
          {item.recommendation_note && <p className="border-l-2 border-ds-line pl-3 text-sm italic text-ds-muted">«{item.recommendation_note}»</p>}
          <div className="flex flex-wrap items-center gap-3"><AppButton disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.editPlan(item.id, { decision: 'selected' }, true))}>Добавить в план</AppButton><button type="button" className="text-sm font-semibold text-ds-muted underline underline-offset-4" onClick={() => setDeclining(true)}>Не интересно</button></div>
        </section>}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <main className="min-w-0 space-y-3">
            {editMode && <div className="flex flex-wrap gap-2"><AppButton size="sm" variant="subtle" onClick={() => setAdding(true)}>Добавить шаги</AppButton><AppButton size="sm" variant="subtle" onClick={() => setSettings(!settings)}>Ментор, срок, причина</AppButton></div>}
            <QueryState isLoading={tasks.isLoading} isError={tasks.isError} error={tasks.error} onRetry={() => tasks.refetch()}>
              {steps.map((task, i) => <div id={`step-${task.id}`} className="scroll-mt-6 space-y-2" key={task.id}>
                {editMode && <div className="flex justify-end gap-1"><AppButton size="sm" variant="subtle" aria-label={`Поднять шаг ${i + 1}`} disabled={!i || action.isPending} onClick={() => moveStep(i, -1)}><ArrowUp className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Опустить шаг ${i + 1}`} disabled={i === steps.length - 1 || action.isPending} onClick={() => moveStep(i, 1)}><ArrowDown className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Копировать шаг ${i + 1}`} disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.create({ student_id: item.student_id, activity_participation_id: item.id, title: task.title, description: task.description, expected_result: task.expected_result, due_date: task.due_date, priority: task.priority, requires_review: task.requires_review !== false, requires_evidence: Boolean(task.requires_evidence), subtasks: task.subtasks.map(s => s.title) }))}><Copy className="h-4 w-4" /></AppButton></div>}
                <LearnerStep key={`${task.id}:${task.review_status}:${task.status}`} task={task} number={i + 1} closed={closed || (own && item.decision !== 'selected')}
                  defaultOpen={openStep === task.id} submissions={submissions.data?.[task.id]} mentorName={item.mentor_name} editMode={editMode}
                  prevPending={i > 0 && steps[i - 1].review_status === 'pending' && steps[i - 1].status !== 'done'} />
              </div>)}
              {!steps.length && <p className="rounded-card border border-dashed border-ds-line p-6 text-sm text-ds-muted">{canManage ? 'Шагов пока нет. Нажмите «Изменить план» и добавьте шаги.' : 'Ментор составит план, шаги появятся здесь.'}</p>}
              {item.decision === 'selected' && <ResultStep item={item} number={steps.length + 1} own={own} canManage={canManage} ready={allRequiredDone && (item.steps?.total ?? 0) > 0} />}
            </QueryState>
          </main>
          <aside className="space-y-4">
            <div className="hidden space-y-4 lg:block">{terms}{why}</div>
            <div className="space-y-3 lg:hidden">
              <details className="rounded-card border border-ds-line bg-ds-panel"><summary className="cursor-pointer px-4 py-3 text-sm font-bold">Сроки</summary><div className="border-t border-ds-line">{terms}</div></details>
              <details className="rounded-card border border-ds-line bg-ds-panel"><summary className="cursor-pointer px-4 py-3 text-sm font-bold">Почему это участие</summary><div className="border-t border-ds-line">{why}</div></details>
            </div>
            {item.goal && <section className="rounded-card border border-ds-line bg-ds-panel p-4"><h2 className="text-sm font-bold">Цель участия</h2><p className="mt-2 whitespace-pre-wrap text-sm">{item.goal}</p></section>}
            {canManage && (item.decision === 'not_interested' || item.status === 'cancelled') && <AppButton size="sm" disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.resume(item.id))}>Возобновить план</AppButton>}
            {item.decline_reason && <p className="text-sm text-ds-muted">Причина отказа: {item.decline_reason}</p>}
            {own && !closed && item.decision !== 'suggested' && <button type="button" className="text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink" onClick={() => setDeclining(!declining)}>Отказаться от участия</button>}
          </aside>
        </div>
        {settings && <section className="space-y-4 rounded-card border border-ds-line bg-ds-panel p-5"><h2 className="text-lg font-bold">Настройки плана</h2><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Ответственный ментор<select className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={mentorId ?? item.mentor_id ?? ''} onChange={e => setMentorId(e.target.value)}><option value="">Пока не назначен</option>{mentors.data?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="block text-sm font-semibold">Личный срок<input className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" type="date" value={due ?? item.personal_deadline ?? ''} onChange={e => setDue(e.target.value)} /></label></div><label className="block text-sm font-semibold">Цель<Textarea value={goal ?? item.goal ?? ''} onChange={e => setGoal(e.target.value)} /></label><label className="block text-sm font-semibold">Пояснение ученику<Textarea value={note ?? item.recommendation_note ?? ''} onChange={e => setNote(e.target.value)} /></label><AppButton disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.editPlan(item.id, { mentor_id: (mentorId ?? item.mentor_id) || null, personal_deadline: (due ?? item.personal_deadline) || null, goal: (goal ?? item.goal) || null, recommendation_note: (note ?? item.recommendation_note) || null }, false))}>Сохранить</AppButton><AppButton variant="subtle" disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.editPlan(item.id, { status: 'cancelled' }, false))}>Отменить участие</AppButton></section>}
        {declining && <section className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-5"><h2 className="font-bold">Отказаться от участия?</h2><p className="text-sm text-ds-muted">План останется в архиве, ментор получит уведомление. Причину можно не указывать.</p><Textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} placeholder="Причина отказа — необязательно" /><div className="flex gap-2"><AppButton disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.editPlan(item.id, { decision: 'not_interested', decline_reason: reason.trim() || null }, true))}>Отказаться</AppButton><AppButton variant="subtle" onClick={() => setDeclining(false)}>Остаться</AppButton></div></section>}
        {adding && <AddParticipationSteps studentId={item.student_id} participationId={item.id} onClose={() => setAdding(false)} />}
      </>}
    </QueryState>
    {action.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(action.error)}</p>}
  </div>
}

/** Кто сейчас должен действовать по этому участию и что именно. */
function needLine(item: Participation, steps: RoadmapTask[], own: boolean): { who: NeedWho; text: string } | null {
  if (item.decision !== 'selected' || item.status === 'cancelled') return null
  if (item.status === 'completed') return null
  const number = (task: RoadmapTask) => steps.indexOf(task) + 1
  const pending = steps.find((t) => t.review_status === 'pending' && t.status !== 'done')
  const returned = steps.find((t) => t.review_status === 'returned' && t.status !== 'done')
  const open = steps.find((t) => t.status !== 'done' && t.review_status !== 'pending')
  if (item.result_review_status === 'pending') return own ? { who: 'mentor', text: 'Итог на проверке.' } : { who: 'me', text: 'Подтвердить итог.' }
  if (!steps.length) return own ? { who: 'mentor', text: 'Ментор готовит шаги.' } : { who: 'me', text: 'Составить план шагов.' }
  if (own && returned) return { who: 'you', text: `Шаг ${number(returned)} вернулся на правки${returned.reviewed_at ? ` ${formatDay(returned.reviewed_at)}` : ''}.${returned.due_date ? ` Срок ${formatDue(returned.due_date)}.` : ''}` }
  if (!own && pending) return { who: 'me', text: `Проверить шаг ${number(pending)}${pending.completed_at ? `, прислан ${formatDay(pending.completed_at)}` : ''}.` }
  if (open) {
    const text = `Шаг ${number(open)}: ${open.title}${open.due_date ? `, срок ${formatDue(open.due_date)}` : ''}.`
    return own ? { who: 'you', text } : { who: 'student', text }
  }
  if (pending) return { who: 'mentor', text: `Шаг ${number(pending)} на проверке${pending.completed_at ? ` с ${formatDay(pending.completed_at)}` : ''}.` }
  return own ? { who: 'you', text: 'Шаги готовы, осталось отправить итог.' } : { who: 'student', text: 'Шаги готовы, ученик отправляет итог.' }
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-ds-muted">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>
}

/** Сроки участия одним списком; пустых строк нет. */
function Terms({ item, lastStepDue }: { item: Participation; lastStepDue: string | undefined }) {
  const intake = intakeLabel(item.intake)
  return <section className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4 text-sm">
    <h2 className="hidden font-bold lg:block">Сроки</h2>
    <dl className="space-y-2">
      {lastStepDue && <Row label="Шаги до" value={formatDay(lastStepDue)} />}
      {item.personal_deadline && <Row label="Личный срок" value={formatDay(item.personal_deadline)} />}
      {item.intake.deadline && <Row label="Подача у организатора" value={formatDay(item.intake.deadline)} />}
      {intake && <Row label="Набор" value={intake} />}
    </dl>
    {item.personal_deadline && <p className="text-xs text-ds-muted">Личный срок ставит ментор, к нему всё должно быть готово с запасом.</p>}
  </section>
}

function Why({ item, own }: { item: Participation; own: boolean }) {
  return <section className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4 text-sm">
    <h2 className="hidden font-bold lg:block">Почему это участие</h2>
    {item.recommendation_note
      ? <p className="whitespace-pre-wrap">{item.recommendation_note}</p>
      : <p className="text-ds-muted">{item.selection_source === 'student' ? 'Выбрано самостоятельно.' : 'Причина не указана.'}</p>}
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <Link to={own ? '/portal/chat' : `/workspace/chat?student_id=${item.student_id}`} className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-4"><MessageCircle className="h-3.5 w-3.5" aria-hidden />{own ? 'Написать ментору' : 'Написать ученику'}</Link>
      {item.activity.source_url && <a className="font-semibold underline underline-offset-4" href={item.activity.source_url} target="_blank" rel="noreferrer">Сайт организатора ↗</a>}
    </div>
  </section>
}
