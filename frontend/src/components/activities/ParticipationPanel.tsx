import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Participation } from '@/api/activities'
import { roadmapApi } from '@/api/roadmap'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton, AppCard } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { CreateTaskDialog } from '@/components/shared/CreateTaskDialog'
import { QueryState } from '@/components/shared/QueryState'
import { getErrorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/utils'
import { StatusTag } from './StatusTag'
import { studentDueText } from '@/lib/studentDeadline'
import { intakeLabel } from '@/lib/activityUi'
import type { RoadmapTask } from '@/api/roadmap'

type StepState = 'done' | 'pending' | 'returned' | 'overdue' | 'todo'
function stepState(task: RoadmapTask): StepState {
  if (task.status === 'done') return 'done'
  if (task.review_status === 'pending') return 'pending'
  if (task.review_status === 'returned') return 'returned'
  return (task.overdue_days ?? 0) > 0 ? 'overdue' : 'todo'
}
const STEP_LABEL: Record<StepState, string> = { done: 'Принято', pending: 'На проверке', returned: 'Нужны правки', overdue: 'Просрочено', todo: 'Предстоит' }
const STEP_TONE: Record<StepState, 'good' | 'neutral' | 'danger' | 'info'> = { done: 'good', pending: 'info', returned: 'danger', overdue: 'danger', todo: 'neutral' }

export function ParticipationPanel({ item, onClose }: { item: Participation; onClose: () => void }) {
  const { user, can } = useAuth()
  const own = user?.role === 'student'
  const workspace = useLocation().pathname.startsWith('/workspace')
  const canTasks = !own && can('roadmaps', 'edit')
  const [goal, setGoal] = useState(item.goal ?? '')
  const [mentorId, setMentorId] = useState(item.mentor_id ?? '')
  const [decision, setDecision] = useState(item.decision)
  const [status, setStatus] = useState(item.status)
  const [personalDeadline, setPersonalDeadline] = useState(item.personal_deadline ?? '')
  const [recommendationNote, setRecommendationNote] = useState(item.recommendation_note ?? '')
  const [create, setCreate] = useState(false)
  const [taskId, setTaskId] = useState('')
  const client = useQueryClient()
  const tasks = useQuery({ queryKey: ['activities', 'tasks', item.id], queryFn: () => activitiesApi.tasks(item.id) })
  const mentors = useQuery({ queryKey: ['activities', 'mentors', item.id], queryFn: () => activitiesApi.mentors(item.id), enabled: !own })
  const existing = useQuery({ queryKey: ['student-tasks', item.student_id], queryFn: () => roadmapApi.studentTasks(item.student_id), enabled: canTasks })
  const refresh = () => { client.invalidateQueries({ queryKey: ['activities'] }); client.invalidateQueries({ queryKey: ['student-tasks', item.student_id] }) }
  const save = useMutation({ mutationFn: () => activitiesApi.editPlan(item.id, own ? { goal: goal.trim() || null, ...(decision !== 'suggested' ? { decision } : {}) } : { goal: goal.trim() || null, decision, mentor_id: mentorId || null, status, personal_deadline: personalDeadline || null, recommendation_note: recommendationNote.trim() || null }, own), onSuccess: () => { refresh(); onClose() } })
  const link = useMutation({ mutationFn: () => activitiesApi.linkTask(item.id, taskId), onSuccess: () => { refresh(); setTaskId('') } })
  const closed = ['completed', 'cancelled'].includes(item.status)
  // Ученик отправляет шаг на проверку отсюда же — тем же запросом, что и
  // галочка в roadmap; ментор принимает или возвращает с комментарием.
  const claim = useMutation({
    mutationFn: ({ id, undo }: { id: string; undo?: boolean }) => undo ? roadmapApi.uncompleteTask(id) : roadmapApi.completeTask(id),
    onSuccess: () => { refresh(); client.invalidateQueries({ queryKey: ['portal'] }) },
  })
  const label = intakeLabel(item.intake)
  const decide = useMutation({
    mutationFn: (next: 'selected' | 'not_interested') => activitiesApi.editPlan(item.id, { goal: goal.trim() || null, decision: next }, true),
    onSuccess: () => { refresh(); onClose() },
  })
  const awaitingDecision = own && item.decision === 'suggested'
  const form = (
      <form onSubmit={e => { e.preventDefault(); save.mutate() }} className={own ? "mt-6 space-y-4 border-t border-ds-line pt-5" : "space-y-4"}>
        {own && <h3 className="text-lg font-bold">Моя цель</h3>}
        <label className="block text-sm font-semibold">{own ? "Чего хотите добиться" : "Цель участия"}<Textarea className="mt-2" maxLength={5000} value={goal} onChange={e => setGoal(e.target.value)} placeholder="Какой опыт или результат хотите получить?" disabled={own && closed} /></label>
        {awaitingDecision ? <div className="space-y-3 rounded-ctl border border-ds-accent-dim p-4">
          <p className="text-sm font-semibold">Ментор рекомендует эту активность. Участвуете?</p>
          <div className="flex flex-wrap gap-3"><AppButton size="sm" disabled={decide.isPending} onClick={() => decide.mutate('selected')}>Участвую</AppButton><AppButton size="sm" variant="subtle" disabled={decide.isPending} onClick={() => decide.mutate('not_interested')}>Не интересно</AppButton></div>
          {decide.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(decide.error)}</p>}
        </div> : <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Решение<select className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={decision} disabled={own && closed} onChange={e => setDecision(e.target.value as Participation['decision'])}>{!own && <option value="suggested">Рекомендовано</option>}<option value="selected">Хочу участвовать</option><option value="not_interested">Не интересно</option>{own && decision === 'suggested' && <option value="suggested" disabled>Рекомендовано ментором</option>}</select></label>
          {!own && <label className="block text-sm font-semibold">Состояние<select className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={status} onChange={e => setStatus(e.target.value as Participation['status'])}><option value="not_started">Планируем</option><option value="in_progress">В работе</option><option value="submitted">Заявка подана организатору</option><option value="completed">Завершено</option><option value="cancelled">Отменено</option></select></label>}
        </div>}
        {!own && <QueryState isLoading={mentors.isLoading} isError={mentors.isError} error={mentors.error} onRetry={() => mentors.refetch()}>
          <label className="block text-sm font-semibold">Ответственный ментор портфолио<select className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={mentorId} onChange={e => setMentorId(e.target.value)}><option value="">Пока не назначен</option>{mentorId && !mentors.data?.some(m => m.id === mentorId) && <option value={mentorId} disabled>{item.mentor_name || 'Предыдущее назначение'} · неактивно</option>}{mentors.data?.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>
          {!mentors.data?.length && <p className="mt-2 text-sm text-ds-muted">Сначала назначьте ученику ментора портфолио в карточке команды.</p>}
        </QueryState>}
        {!own && <><label className="block text-sm font-semibold">Личный срок<input type="date" className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={personalDeadline} onChange={e => setPersonalDeadline(e.target.value)} /></label><label className="block text-sm font-semibold">Причина рекомендации · увидит ученик<Textarea className="mt-2" maxLength={2000} value={recommendationNote} onChange={e => setRecommendationNote(e.target.value)} /></label></>}
        <p className="text-xs text-ds-muted">Дедлайн организатора: {item.intake.deadline ? formatDate(item.intake.deadline) : 'Дата неизвестна'}</p>
        {own && <p className="text-sm text-ds-muted">Ответственный: {item.mentor_name || 'Ещё не назначен'}. Проверку результата ведёт ментор.</p>}
        {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
        <AppButton type="submit" disabled={save.isPending || (own && closed)}>{save.isPending ? 'Сохраняем…' : own ? 'Сохранить цель' : 'Сохранить план'}</AppButton>
      </form>
  )
  const steps = (
      <section className={own ? "space-y-4" : "mt-3 space-y-4 border-t border-ds-line pt-5"}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">Шаги по активности</h3>{canTasks && !closed && item.decision !== 'not_interested' && <AppButton variant="subtle" onClick={() => setCreate(true)}>Добавить задачу</AppButton>}</div>
        <QueryState isLoading={tasks.isLoading} isError={tasks.isError} error={tasks.error} onRetry={() => tasks.refetch()}>
          {!tasks.data?.length && <p className="text-sm text-ds-muted">Шаги пока не добавлены. Ментор составит план, и они появятся здесь.</p>}
          {tasks.data?.map(task => { const state = stepState(task); return <AppCard key={task.id} className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words font-bold">{task.title}</h4><StatusTag tone={STEP_TONE[state]} className="shrink-0">{STEP_LABEL[state]}</StatusTag></div>
            <p className={`text-sm ${state === 'overdue' ? 'text-ds-danger' : 'text-ds-muted'}`}>{own ? studentDueText(task, state === 'done') : `Личный срок: ${task.due_date ? formatDate(task.due_date) : 'Не установлен'}`}</p>
            {task.expected_result && <p className="whitespace-pre-wrap text-sm">Результат: {task.expected_result}</p>}
            {task.review_comment && <div className={`rounded-ctl border p-3 text-sm ${state === 'returned' ? 'border-ds-danger/50' : 'border-ds-line'}`}><p className="text-xs font-bold text-ds-muted">Комментарий ментора</p><p className="mt-1 whitespace-pre-wrap">{task.review_comment}</p></div>}
            {own && !closed && state !== 'done' && <div className="flex flex-wrap items-center gap-3 pt-1">
              {state === 'pending'
                ? <><span className="text-sm text-ds-muted">Ментор проверит и ответит здесь.</span><AppButton size="sm" variant="subtle" disabled={claim.isPending} onClick={() => claim.mutate({ id: task.id, undo: true })}>Отозвать</AppButton></>
                : <AppButton size="sm" disabled={claim.isPending} onClick={() => claim.mutate({ id: task.id })}>{state === 'returned' ? 'Исправлено — отправить снова' : 'Отправить на проверку'}</AppButton>}
            </div>}
          </AppCard> })}
          {claim.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(claim.error)}</p>}
        </QueryState>
        {canTasks && !closed && item.decision !== 'not_interested' && <QueryState isLoading={existing.isLoading} isError={existing.isError} error={existing.error} onRetry={() => existing.refetch()}>
          <div className="space-y-2"><label className="block text-sm font-semibold">Привязать существующую задачу<select className="mt-2 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">Выберите задачу ученика</option>{existing.data?.filter(t => !t.activity_participation_id).map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label><AppButton variant="subtle" disabled={!taskId || link.isPending} onClick={() => link.mutate()}>Привязать к активности</AppButton>{link.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(link.error)}</p>}</div>
        </QueryState>}
        <Link className="inline-block text-sm font-bold underline underline-offset-4" to={own ? '/portal/tasks' : workspace ? `/workspace/tasks?student_id=${item.student_id}` : `/workspace/tasks?student_id=${item.student_id}`}>{own ? 'Все мои задачи' : 'Открыть очередь задач · проверить результаты'}</Link>
      </section>
  )
  return <>
    <Dialog open onOpenChange={open => { if (!open && !save.isPending && !link.isPending) onClose() }}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>{item.activity.title}</DialogTitle><DialogDescription>{own ? `${label ? `${label} · ` : ''}Ваши шаги и цель участия. Срок каждого шага свой — он не совпадает с дедлайном организатора.` : `${item.student_name ? `${item.student_name} · ` : ''}Личный план${label ? ` · ${label}` : ''}. Дедлайн организатора и сроки задач задаются отдельно.`}</DialogDescription></DialogHeader>
      {own ? <>{steps}{form}</> : <>{form}{steps}</>}
    </DialogContent></Dialog>
    {create && <CreateTaskDialog colorPrefix={workspace ? 'w' : 'ds'} initialKind="student" activityParticipationId={item.id} defaultStudent={{ id: item.student_id, name: item.student_name || 'Выбранный ученик' }} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); refresh(); client.invalidateQueries({ queryKey: ['student-roadmaps', item.student_id] }) }} />}
  </>
}
