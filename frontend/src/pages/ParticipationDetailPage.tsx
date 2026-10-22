import { learnerTasksApi } from '@/api/learnerTasks'
import { useWsEvent } from '@/lib/ws'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, ArrowDown, Copy, MessageCircle, MoreHorizontal } from 'lucide-react'
import { activitiesApi } from '@/api/activities'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryState } from '@/components/shared/QueryState'
import { LearnerStep } from '@/components/activities/LearnerStep'
import { ResultStep } from '@/components/activities/ResultStep'
import { AddParticipationSteps } from '@/components/activities/AssignmentDialog'
import { StatusTag } from '@/components/activities/StatusTag'
import { getErrorMessage } from '@/lib/errorMessage'
import { EXPERIENCE_LABEL, actionCopy, participationStatus } from '@/lib/activityUi'
import { formatDay } from '@/lib/portfolio/dictionary'

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
  const summary = useQuery({ queryKey: ['activities', 'summary', own ? 'mine' : item?.student_id], queryFn: () => activitiesApi.summary(own ? undefined : item!.student_id), enabled: own || (canManage && !!item) })
  const now = (own ? summary.data?.actions : summary.data?.mentor_actions)?.find(a => a.participation_id === participationId)
  const nowCopy = now && actionCopy(now, own ? 'student' : 'staff')
  const closed = !item || ['completed', 'cancelled'].includes(item.status) || item.decision === 'not_interested'
  const pendingResult = item?.result_review_status === 'pending'
  const allRequiredDone = tasks.data?.every(t => t.priority !== 'required' || t.status === 'done') ?? false
  // Открыт шаг из ссылки (#step-…), иначе — текущий шаг плана.
  const { hash } = useLocation()
  const openStep = hash.startsWith('#step-') ? hash.slice(6) : item?.steps?.next?.id
  useEffect(() => {
    if (!hash || !tasks.data) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, tasks.data])
  const moveStep = (index: number, delta: number) => {
    const order = (tasks.data ?? []).map(t => t.id)
    ;[order[index], order[index + delta]] = [order[index + delta], order[index]]
    action.mutate(() => activitiesApi.reorderSteps(participationId, order))
  }
  const back = own ? '/portal/activities' : item ? `/workspace/activities?view=plan&student_id=${item.student_id}` : '/workspace/activities'
  const status = item ? participationStatus(item) : ''
  return <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 text-ds-ink sm:px-6">
    <Link className="inline-flex items-center gap-2 text-sm font-semibold text-ds-muted hover:text-ds-ink" to={back}><ArrowLeft className="h-4 w-4" />{own ? 'К портфолио' : 'К портфолио ученика'}</Link>
    <QueryState isLoading={itemQuery.isLoading} isError={itemQuery.isError} error={itemQuery.error} onRetry={() => itemQuery.refetch()}>
      {item && <>
        <header className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-5 sm:p-6"><p className="text-xs text-ds-muted">{EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']} · участие{!own && ` · ${item.student_name || 'Ученик'}`}</p><div className="flex flex-wrap items-start justify-between gap-3"><h1 className="min-w-0 break-words text-2xl font-bold sm:text-3xl">{item.activity.title}</h1><StatusTag tone={item.status === 'completed' ? 'good' : pendingResult ? 'info' : 'neutral'}>{status}</StatusTag></div><div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ds-muted"><span>Готово шагов: {item.steps?.done ?? 0} из {item.steps?.total ?? 0}</span>{(item.steps?.pending ?? 0) > 0 && <span>{item.steps?.pending} на проверке</span>}</div></header>
        {nowCopy && now?.kind !== 'decide' && <div className={`flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 text-sm ${nowCopy.tone === 'calm' ? 'border-ds-line bg-ds-panel' : nowCopy.tone === 'urgent' ? 'border-ds-danger/40 bg-ds-danger/[0.06]' : 'border-ds-accent-dim bg-ds-accent/[0.07]'}`}><span className="text-2xs font-bold uppercase tracking-caps text-ds-muted">Сейчас</span><span className="min-w-0 flex-1 break-words font-semibold">{nowCopy.title}</span>{nowCopy.cta && <a href={now.step_id ? `#step-${now.step_id}` : '#result'} className="shrink-0 font-bold underline underline-offset-4">{nowCopy.cta}</a>}</div>}
        {own && item.decision === 'suggested' && !closed && <div className="space-y-3 rounded-card border border-ds-accent-dim bg-ds-panel p-5"><p className="font-semibold">Рекомендация ментора. Добавите в план?</p>{item.recommendation_note && <p className="text-sm text-ds-muted">{item.recommendation_note}</p>}<div className="flex flex-wrap gap-2"><AppButton disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.editPlan(item.id, { decision: 'selected' }, true))}>Добавить в план</AppButton><AppButton variant="subtle" onClick={() => setDeclining(true)}>Не интересно</AppButton></div></div>}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <main className="min-w-0 space-y-6">
            <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">План участия</h2><p className="mt-1 text-sm text-ds-muted">Шаги по порядку, последний — итог и сертификат.</p></div>{canManage && !closed && <AppButton size="sm" variant="subtle" onClick={() => setAdding(true)}>Добавить шаги</AppButton>}</div><QueryState isLoading={tasks.isLoading} isError={tasks.isError} error={tasks.error} onRetry={() => tasks.refetch()}>
              {tasks.data?.map((task, i) => <div id={`step-${task.id}`} className="scroll-mt-6 space-y-2" key={task.id}>{canManage && !closed && <div className="flex justify-end gap-1"><AppButton size="sm" variant="subtle" aria-label={`Поднять шаг ${i + 1}`} disabled={!i || action.isPending} onClick={() => moveStep(i, -1)}><ArrowUp className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Опустить шаг ${i + 1}`} disabled={i === (tasks.data?.length ?? 0) - 1 || action.isPending} onClick={() => moveStep(i, 1)}><ArrowDown className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Копировать шаг ${i + 1}`} disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.create({ student_id: item.student_id, activity_participation_id: item.id, title: task.title, description: task.description, expected_result: task.expected_result, due_date: task.due_date, priority: task.priority, requires_review: task.requires_review !== false, requires_evidence: Boolean(task.requires_evidence), subtasks: task.subtasks.map(s => s.title) }))}><Copy className="h-4 w-4" /></AppButton></div>}<LearnerStep key={`${task.id}:${task.review_status}:${task.status}`} task={task} number={i + 1} closed={closed || (own && item.decision !== 'selected')} defaultOpen={openStep === task.id} /></div>)}
              {!tasks.data?.length && <p className="rounded-card border border-dashed border-ds-line p-6 text-sm text-ds-muted">{canManage ? 'Соберите индивидуальные шаги в конструкторе. Roadmap для этого не нужен.' : 'Ментор составит план; шаги появятся здесь.'}</p>}
              {item.decision === 'selected' && <ResultStep item={item} number={(tasks.data?.length ?? 0) + 1} own={own} canManage={canManage} ready={allRequiredDone && (item.steps?.total ?? 0) > 0} />}
            </QueryState></section>
          </main>
          <aside className="order-first space-y-4 rounded-card border border-ds-line bg-ds-panel p-5 lg:order-last"><details open><summary className="cursor-pointer text-base font-bold">Об участии</summary><dl className="mt-4 space-y-4 text-sm"><div><dt className="text-xs text-ds-muted">Ментор</dt><dd className="mt-1 font-semibold">{item.mentor_name || 'Пока не назначен'}</dd><dd className="mt-1"><Link to={own ? '/portal/chat' : `/workspace/chat?student_id=${item.student_id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-4"><MessageCircle className="h-3.5 w-3.5" aria-hidden />{own ? 'Написать ментору' : 'Написать ученику'}</Link></dd></div><div><dt className="text-xs text-ds-muted">Тип опыта</dt><dd className="mt-1">{EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']}</dd></div><div><dt className="text-xs text-ds-muted">Подача у организатора</dt><dd className="mt-1">{item.intake.deadline ? `до ${formatDay(item.intake.deadline)}` : 'Дата не указана'}</dd></div>{item.personal_deadline && <div><dt className="text-xs text-ds-muted">Личный срок</dt><dd className="mt-1">{formatDay(item.personal_deadline)}</dd></div>}<div><dt className="text-xs text-ds-muted">Набор</dt><dd className="mt-1">{item.intake.label}</dd></div></dl>{item.activity.description && <p className="mt-4 whitespace-pre-wrap text-sm text-ds-muted">{item.activity.description}</p>}{item.activity.source_url && <a className="mt-3 inline-block text-sm font-semibold underline" href={item.activity.source_url} target="_blank" rel="noreferrer">Сайт организатора</a>}</details>
            {own && !closed && <details className="text-sm"><summary className="cursor-pointer font-semibold">Моя цель участия</summary><Textarea className="mt-2" value={goal ?? item.goal ?? ''} maxLength={5000} onChange={e => setGoal(e.target.value)} /><AppButton size="sm" className="mt-2" disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.editPlan(item.id, { goal: (goal ?? item.goal) || null }, true))}>Сохранить цель</AppButton></details>}
            {item.goal && <div><h3 className="text-sm font-bold">Цель участия</h3><p className="mt-2 whitespace-pre-wrap text-sm">{item.goal}</p></div>}
            {item.recommendation_note && <div><h3 className="text-sm font-bold">От ментора</h3><p className="mt-2 whitespace-pre-wrap text-sm">{item.recommendation_note}</p></div>}
            {canManage && !closed && <AppButton size="sm" variant="subtle" onClick={() => setSettings(!settings)}>Редактировать план</AppButton>}
            {own && !closed && item.decision !== 'suggested' && <AppButton size="sm" variant="subtle" onClick={() => setDeclining(!declining)}><MoreHorizontal className="h-4 w-4" />Отказаться от участия</AppButton>}
            {canManage && (item.decision === 'not_interested' || item.status === 'cancelled') && <AppButton size="sm" disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.resume(item.id))}>Возобновить план</AppButton>}
            {item.decline_reason && <p className="text-sm text-ds-muted">Причина отказа: {item.decline_reason}</p>}
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
