import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CheckCircle2, Clock, Play } from 'lucide-react'
import type { RoadmapTask } from '@/api/roadmap'
import { learnerTasksApi } from '@/api/learnerTasks'
import { roadmapApi } from '@/api/roadmap'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { PortfolioFiles } from './PortfolioFiles'
import { StatusTag } from './StatusTag'
import { STEP_STATUS, stepStatus } from '@/lib/portfolio/dictionary'
import { studentDueText } from '@/lib/studentDeadline'
import { getErrorMessage } from '@/lib/errorMessage'

export function LearnerStep({ task, number, closed = false, defaultOpen = false }: { task: RoadmapTask; number?: number; closed?: boolean; defaultOpen?: boolean }) {
  const { user, can } = useAuth()
  const own = user?.role === 'student'
  const canEdit = !own && can(task.activity_participation_id ? 'portfolio' : 'roadmaps', task.activity_participation_id ? 'manage' : 'edit')
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState(task.result_text ?? '')
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [expected, setExpected] = useState(task.expected_result)
  const [due, setDue] = useState(task.due_date ?? '')
  const [review, setReview] = useState(task.requires_review !== false)
  const [evidence, setEvidence] = useState(Boolean(task.requires_evidence))
  const client = useQueryClient()
  const done = task.status === 'done'
  const pending = task.review_status === 'pending' && !done
  const returned = task.review_status === 'returned' && !done
  const state = STEP_STATUS[stepStatus(task)].label
  const refresh = () => { ['activities', 'portal', 'workspace', 'student-tasks', 'student-roadmaps', 'learner-task'].forEach(key => client.invalidateQueries({ queryKey: [key] })); setEditing(false) }
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh })
  const locked = closed || done || pending
  return <article className="overflow-hidden rounded-card border border-ds-line bg-ds-panel">
    <button aria-expanded={open} className="flex w-full flex-wrap items-start gap-3 p-4 text-left sm:p-5" onClick={() => setOpen(!open)}>
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ds-good" /> : pending ? <Clock className="mt-0.5 h-5 w-5 shrink-0 text-ds-info" /> : <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-2xs font-bold ${returned ? 'border-ds-danger text-ds-danger' : 'border-ds-line text-ds-muted'}`}>{number ?? ''}</span>}
      <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{task.title}</span><span className="mt-1 block text-xs text-ds-muted">{studentDueText(task, done)} · {task.priority === 'required' ? 'Обязательно' : task.priority === 'recommended' ? 'Желательно' : 'По желанию'}{task.activity_participation_id && task.requires_review !== false ? ' · проверит ментор' : ''}</span></span>
      <span className="ml-8 flex w-full shrink-0 items-center justify-between gap-2 sm:ml-0 sm:w-auto"><StatusTag tone={done ? 'good' : returned ? 'danger' : pending ? 'info' : 'neutral'}>{state}</StatusTag><ChevronDown className={`h-4 w-4 text-ds-muted transition ${open ? 'rotate-180' : ''}`} /></span>
    </button>
    {open && <div className="space-y-4 border-t border-ds-line p-4 sm:p-5">
      {editing ? <div className="space-y-3"><label className="block text-sm font-semibold">Название<input className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /></label><label className="block text-sm font-semibold">Описание<Textarea value={description} onChange={e => setDescription(e.target.value)} /></label><label className="block text-sm font-semibold">Ожидаемый результат<Textarea value={expected} onChange={e => setExpected(e.target.value)} /></label><label className="block text-sm">Срок<input type="date" className="ml-3 rounded-ctl border border-ds-line bg-ds-panel p-2" value={due} onChange={e => setDue(e.target.value)} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} />Проверка ментора</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={evidence} onChange={e => setEvidence(e.target.checked)} />Обязательный файл</label><AppButton size="sm" disabled={!title.trim() || action.isPending} onClick={() => action.mutate(() => learnerTasksApi.update(task.id, { title, description, expected_result: expected, due_date: due || null, requires_review: review, requires_evidence: evidence }))}>Сохранить шаг</AppButton><AppButton size="sm" variant="subtle" onClick={() => setEditing(false)}>Отмена</AppButton></div> : <>
        {task.description && <p className="whitespace-pre-wrap break-words text-sm">{task.description}</p>}
        {task.expected_result && <div className="rounded-ctl bg-ds-panel2 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-ds-muted">Что сдать</p><p className="whitespace-pre-wrap">{task.expected_result}</p></div>}
        {!!task.subtasks.length && <ul className="space-y-2">{task.subtasks.map(sub => <li key={sub.id}><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={sub.is_done} disabled={locked || action.isPending} onChange={e => action.mutate(() => learnerTasksApi.checklist(task.id, sub.id, e.target.checked))} /><span className="break-words">{sub.title}</span></label></li>)}</ul>}
        {task.review_comment && <div className={`rounded-ctl border p-3 text-sm ${returned ? 'border-ds-danger/40' : 'border-ds-line'}`}><p className="mb-1 font-semibold">Комментарий ментора</p><p className="whitespace-pre-wrap">{task.review_comment}</p></div>}
        <section className="space-y-2"><h4 className="text-sm font-semibold">Файлы {task.requires_evidence && <span className="text-ds-muted">· нужен файл</span>}</h4><PortfolioFiles target={{ task_id: task.id }} editable={!locked && own} /></section>
        {own && !locked && <label className="block text-sm font-semibold">Результат или пояснение<Textarea className="mt-2" value={text} maxLength={20000} onChange={e => setText(e.target.value)} placeholder="Что получилось, ссылка на работу или пояснение" /></label>}
        {(!own || locked) && task.result_text && <p className="whitespace-pre-wrap break-words text-sm">{task.result_text}</p>}
        <div className="flex flex-wrap gap-2">
          {own && !closed && !done && (pending ? <AppButton size="sm" variant="subtle" disabled={action.isPending} onClick={() => action.mutate(() => roadmapApi.uncompleteTask(task.id))}>Отозвать с проверки</AppButton> : <><AppButton size="sm" disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.complete(task.id, text))}>{task.requires_review !== false ? returned ? 'Исправлено — отправить снова' : 'Отправить на проверку' : 'Готово'}</AppButton>{task.status === 'planned' && <AppButton size="sm" variant="subtle" disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.start(task.id))}><Play className="h-3 w-3" />Начать</AppButton>}</>)}
          {canEdit && !closed && !pending && !done && <><AppButton size="sm" variant="subtle" onClick={() => setEditing(true)}>Редактировать шаг</AppButton><AppButton size="sm" variant="subtle" disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.remove(task.id))}>Убрать из плана</AppButton></>}
        </div>
        {canEdit && pending && !closed && <div className="space-y-3 rounded-panel bg-ds-panel2 p-4"><label className="block text-sm font-semibold">Комментарий к проверке<Textarea className="mt-2" value={comment} onChange={e => setComment(e.target.value)} placeholder="При возврате укажите, что исправить" /></label><div className="flex flex-wrap gap-2"><AppButton size="sm" disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.review(task.id, 'approve', comment))}>Принять</AppButton><AppButton size="sm" variant="subtle" disabled={!comment.trim() || action.isPending} onClick={() => action.mutate(() => learnerTasksApi.review(task.id, 'return', comment))}>Вернуть на правки</AppButton></div></div>}
      </>}
      {action.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(action.error)}</p>}
    </div>}
  </article>
}
