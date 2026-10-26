import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Check, X } from 'lucide-react'
import type { RoadmapTask } from '@/api/roadmap'
import type { Submission } from '@/api/activities'
import { learnerTasksApi } from '@/api/learnerTasks'
import { roadmapApi } from '@/api/roadmap'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { DeadlineField } from '@/components/shared/DeadlineField'
import { InlineField } from '@/components/shared/InlineField'
import { cn } from '@/lib/utils'
import { PortfolioFiles } from './PortfolioFiles'
import { StatusTag } from './StatusTag'
import { MentorComment } from './shared/MentorComment'
import { SubmissionView } from './shared/SubmissionView'
import { STEP_STATUS, formatDay, formatDue, stepStatus } from '@/lib/portfolio/dictionary'
import { overdueDaysOf } from '@/lib/roadmapDeadline'
import { getErrorMessage } from '@/lib/errorMessage'

/**
 * Шаг плана участия. Ученик видит по порядку: комментарий ментора, что отправлял
 * раньше, что сдать, чеклист, файлы и отправку. Ментор видит то же, но вместо
 * отправки — присланное учеником и решение «Принять / Вернуть с комментарием».
 * В режиме правки (`editMode`) шаг правится как задача Roadmap: название, срок и «что сдать» по клику.
 */
export function LearnerStep({ task, number, closed = false, defaultOpen = false, submissions = [], mentorName, editMode = false }: {
  task: RoadmapTask; number?: number; closed?: boolean; defaultOpen?: boolean
  submissions?: Submission[]; mentorName?: string | null; editMode?: boolean
}) {
  const { user, can } = useAuth()
  const own = user?.role === 'student'
  const canEdit = !own && can(task.activity_participation_id ? 'portfolio' : 'roadmaps', task.activity_participation_id ? 'manage' : 'edit')
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState(task.review_status === 'returned' ? '' : task.result_text ?? '')
  const [comment, setComment] = useState('')
  const [returning, setReturning] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const client = useQueryClient()
  const status = stepStatus(task)
  const done = status === 'done'
  const pending = status === 'pending'
  const returned = status === 'returned'
  const refresh = () => { ['activities', 'portal', 'workspace', 'student-tasks', 'student-roadmaps', 'learner-task'].forEach(key => client.invalidateQueries({ queryKey: [key] })); setReturning(false) }
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh })
  const locked = closed || done || pending
  // Ментор правит шаг на месте, даже отправленный: текст и срок — да, правила проверки — после решения.
  const manage = canEdit && editMode && !closed
  const update = (body: Parameters<typeof learnerTasksApi.update>[1]) => action.mutate(() => learnerTasksApi.update(task.id, body))
  const reviewed = task.activity_participation_id && task.requires_review !== false
  const late = overdueDaysOf(task, done)
  const lastReturned = submissions.find((s) => s.verdict === 'returned')
  const current = submissions.find((s) => s.verdict === 'pending')
  const meta = [
    task.due_date && late <= 0 ? formatDay(task.due_date) : null,
    reviewed ? null : own ? 'закроете сами' : 'ученик закроет сам',
    task.requires_evidence ? 'нужен файл' : null,
  ].filter(Boolean).join(' · ')
  return <article className={cn('group overflow-hidden rounded-card border bg-ds-panel', returned && own ? 'border-ds-danger/40' : 'border-ds-line')}>
    {manage ? <div className="flex flex-wrap items-start gap-x-3 gap-y-2 p-4 sm:flex-nowrap sm:p-5">
      <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-2xs font-bold', done ? 'border-ds-good bg-ds-good/15 text-ds-good' : 'border-ds-line text-ds-muted')}>
        {done ? <Check className="h-3.5 w-3.5" /> : number ?? ''}
      </span>
      <div className="min-w-[10rem] flex-1">
        <InlineField value={task.title} canEdit required className="font-semibold text-ds-ink" onSave={(title) => update({ title })} label="Название шага" />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ds-muted">
          <DeadlineField tone="w" className="justify-start" dueDate={task.due_date} overdueDays={late} done={done} onChange={(due_date) => update({ due_date })} label={`Срок шага «${task.title}»`} />
          <button type="button" disabled={pending || action.isPending} onClick={() => update({ requires_review: !reviewed })} title={pending ? 'Сначала разберите отправленную работу' : 'Кто закрывает шаг'}
            className={cn('rounded-pill border border-ds-line px-2 py-0.5 font-semibold transition hover:border-ds-muted2 hover:text-ds-ink sm:focus-visible:opacity-100 disabled:opacity-60', reviewed && 'sm:opacity-0 sm:group-hover:opacity-100')}>{reviewed ? 'проверяете вы' : 'ученик закроет сам'}</button>
          <button type="button" disabled={pending || action.isPending} onClick={() => update({ requires_evidence: !task.requires_evidence })} title={pending ? 'Сначала разберите отправленную работу' : 'Нужен ли файл от ученика'}
            className={cn('rounded-pill border border-ds-line px-2 py-0.5 font-semibold transition hover:border-ds-muted2 hover:text-ds-ink sm:focus-visible:opacity-100 disabled:opacity-60', !task.requires_evidence && 'sm:opacity-0 sm:group-hover:opacity-100')}>{task.requires_evidence ? 'нужен файл' : 'без файла'}</button>
        </div>
      </div>
      <span className="ml-9 flex shrink-0 items-center gap-2 sm:ml-0">
        <StatusTag tone={STEP_STATUS[status].tone}>{STEP_STATUS[status].label}</StatusTag>
        {confirmRemove
          ? <span className="text-xs text-ds-danger">Удалить? <button type="button" className="font-bold underline" onClick={() => action.mutate(() => learnerTasksApi.remove(task.id))}>Да</button> <button type="button" className="underline" onClick={() => setConfirmRemove(false)}>Нет</button></span>
          : <button type="button" onClick={() => setConfirmRemove(true)} aria-label={`Удалить шаг «${task.title}»`} title="Удалить шаг" className="text-ds-muted transition hover:text-ds-danger"><X className="h-4 w-4" /></button>}
        <button type="button" aria-expanded={open} aria-label={open ? 'Свернуть шаг' : 'Раскрыть шаг'} onClick={() => setOpen(!open)} className="text-ds-muted hover:text-ds-ink"><ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} /></button>
      </span>
    </div> : <button aria-expanded={open} className="flex w-full flex-wrap items-start gap-3 p-4 text-left sm:p-5" onClick={() => setOpen(!open)}>
          <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-2xs font-bold',
            done ? 'border-ds-good bg-ds-good/15 text-ds-good' : returned ? 'border-ds-danger text-ds-danger' : 'border-ds-line text-ds-muted')}>
            {done ? <Check className="h-3.5 w-3.5" /> : number ?? ''}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words font-semibold">{task.title}</span>
            <span className="mt-1 block text-xs text-ds-muted">
              {late > 0 && task.due_date && <span className="font-semibold text-ds-danger">{formatDay(task.due_date)}, {formatDue(task.due_date)}{meta ? ' · ' : ''}</span>}
              {meta}
            </span>
          </span>
          <span className="ml-9 flex w-full shrink-0 items-center justify-between gap-2 sm:ml-0 sm:w-auto">
            <StatusTag tone={STEP_STATUS[status].tone}>{STEP_STATUS[status].label}</StatusTag>
            <ChevronDown className={`h-4 w-4 text-ds-muted transition ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>}
    {open && <div className="space-y-4 border-t border-ds-line p-4 sm:p-5">
      <>
        {returned && task.review_comment && <MentorComment text={task.review_comment} author={mentorName} at={task.reviewed_at} />}
        {own && returned && lastReturned && <SubmissionView submission={lastReturned} title="Вы отправляли" />}
        {!own && pending && (current
          ? <SubmissionView submission={current} title="Ученик прислал" />
          : task.result_text && <p className="whitespace-pre-wrap break-words rounded-ctl border border-ds-line p-3 text-sm">{task.result_text}</p>)}
        {manage ? <>
          <div className="rounded-ctl bg-ds-panel2 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-ds-muted">Что сдать</p><InlineField value={task.expected_result} canEdit multiline emptyLabel="+ что сдать" className="text-sm text-ds-ink" onSave={(expected_result) => update({ expected_result })} label="Что сдать" /></div>
          <InlineField value={task.description} canEdit multiline emptyLabel="+ описание для ученика" className="text-sm text-ds-muted" onSave={(description) => update({ description })} label="Описание шага" />
        </> : <>
          {task.expected_result && <div className="rounded-ctl bg-ds-panel2 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-ds-muted">Что сдать</p><p className="whitespace-pre-wrap">{task.expected_result}</p></div>}
          {task.description && <p className="whitespace-pre-wrap break-words text-sm">{task.description}</p>}
        </>}
        {!!task.subtasks.length && <section className="space-y-2">
          <h4 className="text-sm font-semibold">Чеклист</h4>
          <ul className="space-y-2">{task.subtasks.map(sub => <li key={sub.id}><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={sub.is_done} disabled={!own || locked || action.isPending} onChange={e => action.mutate(() => learnerTasksApi.checklist(task.id, sub.id, e.target.checked))} /><span className="break-words">{sub.title}</span></label></li>)}</ul>
        </section>}
        {(own || !pending) && <section className="space-y-2">
          <h4 className="text-sm font-semibold">Файлы</h4>
          <PortfolioFiles target={{ task_id: task.id }} editable={!locked && (own || (canEdit && can('documents', 'manage')))} />
        </section>}
        {own && !locked && <label className="block text-sm font-semibold">{returned ? 'Комментарий к новой версии' : 'Комментарий к работе'}
          <Textarea className="mt-2" value={text} maxLength={20000} onChange={e => setText(e.target.value)} placeholder="Что изменили, ссылка на работу или пояснение" /></label>}
        {own && !closed && !done && <div className="flex flex-wrap gap-2">
          {pending
            ? <AppButton size="sm" variant="subtle" disabled={action.isPending} onClick={() => action.mutate(() => roadmapApi.uncompleteTask(task.id))}>Отозвать с проверки</AppButton>
            : <AppButton className="w-full sm:w-auto" disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.complete(task.id, text))}>{reviewed ? 'Отправить на проверку' : 'Готово'}</AppButton>}
        </div>}
        {canEdit && pending && !closed && <div className="space-y-3 rounded-panel bg-ds-panel2 p-4">
          {returning && <label className="block text-sm font-semibold">Что исправить<Textarea className="mt-2" value={comment} onChange={e => setComment(e.target.value)} placeholder="Напишите, что именно поправить" /></label>}
          <div className="flex flex-wrap gap-2">
            {!returning && <AppButton size="sm" disabled={action.isPending} onClick={() => action.mutate(() => learnerTasksApi.review(task.id, 'approve', ''))}>Принять</AppButton>}
            {returning
              ? <><AppButton size="sm" disabled={!comment.trim() || action.isPending} onClick={() => action.mutate(() => learnerTasksApi.review(task.id, 'return', comment))}>Отправить комментарий</AppButton>
                  <AppButton size="sm" variant="subtle" onClick={() => setReturning(false)}>Отмена</AppButton></>
              : <AppButton size="sm" variant="subtle" onClick={() => setReturning(true)}>Вернуть с комментарием</AppButton>}
          </div>
        </div>}
      </>
      {action.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(action.error)}</p>}
    </div>}
  </article>
}
