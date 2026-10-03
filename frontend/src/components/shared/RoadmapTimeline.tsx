import React, { useMemo, useState } from 'react'
import { Check, ChevronRight, Eye, EyeOff, Plus, X, Clock } from 'lucide-react'
import {
  roadmapApi,
  Roadmap,
  RoadmapStage,
  RoadmapTask,
  ItemStatus,
} from '@/api/roadmap'
import { cn } from '@/lib/utils'
import { StatusPill, PriorityPill, AppButton } from '@/components/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Input } from '@/components/ui/primitives/input'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { Label } from '@/components/ui/primitives/label'
import { DeadlineField } from '@/components/shared/DeadlineField'
import { overdueDaysOf, sortSubtasksByDeadline } from '@/lib/roadmapDeadline'

const STAGE_CYCLE: Record<ItemStatus, ItemStatus> = {
  planned: 'in_progress',
  in_progress: 'done',
  done: 'planned',
}

function taskCounts(roadmap: Roadmap) {
  let total = 0
  let done = 0
  for (const s of roadmap.stages) {
    for (const t of s.tasks) {
      total += 1
      if (t.status === 'done') done += 1
    }
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 }
}

export const RoadmapTimeline: React.FC<{
  roadmap: Roadmap
  canManage?: boolean
  onChanged: (updated: Roadmap) => void
}> = ({ roadmap, canManage = false, onChanged }) => {
  const { total, done, pct } = useMemo(() => taskCounts(roadmap), [roadmap])
  const [busy, setBusy] = useState(false)
  const [newTaskStage, setNewTaskStage] = useState<RoadmapStage | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDueDate, setNewTaskDueDate] = useState('')
  const [uncheckTask, setUncheckTask] = useState<RoadmapTask | null>(null)

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    const current =
      roadmap.stages.find((s) => s.status === 'in_progress') ||
      roadmap.stages.find((s) => s.status !== 'done')
    if (current) initial[current.id] = true
    return initial
  })

  const run = async (fn: () => Promise<Roadmap>) => {
    if (busy) return
    setBusy(true)
    try {
      onChanged(await fn())
    } catch (err) {
      // Раньше ошибка проглатывалась молча: запрос падал, экран не менялся, и
      // выглядело это как «кнопка не работает».
      const detail = (err as { response?: { data?: { detail?: { message?: string } | string } } })
        ?.response?.data?.detail
      toast({
        title: typeof detail === 'object' && detail?.message
          ? detail.message
          : getErrorMessage(err, 'Не удалось обновить roadmap'),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  // Снятие отметки подтверждаем: оно откатывает и сам этап, если тот уже был
  // завершён, а у подтверждённой заявки студента стирает штампы ревью.
  const toggleTask = (t: RoadmapTask) => {
    if (t.status === 'done') {
      setUncheckTask(t)
      return
    }
    run(() => roadmapApi.updateTask(t.id, { status: 'done' }))
  }

  const confirmUncheck = (t: RoadmapTask) => {
    setUncheckTask(null)
    run(() => roadmapApi.updateTask(t.id, { status: 'planned' }))
  }

  const toggleTaskVisibility = (t: RoadmapTask) =>
    run(() => roadmapApi.updateTask(t.id, { visible_to_student: !t.visible_to_student }))

  const toggleStageVisibility = (s: RoadmapStage) =>
    run(() => roadmapApi.updateStage(s.id, { visible_to_student: !s.visible_to_student }))

  const toggleSubtask = (subId: string, isDone: boolean) =>
    run(() => roadmapApi.updateSubtask(subId, { is_done: !isDone }))

  const cycleStage = (s: RoadmapStage) =>
    run(() => roadmapApi.updateStage(s.id, { status: STAGE_CYCLE[s.status] }))

  const openAddTask = (s: RoadmapStage) => {
    setNewTaskStage(s)
    setNewTaskTitle('')
    setNewTaskDueDate('')
  }
  const submitAddTask = () => {
    const title = newTaskTitle.trim()
    const stage = newTaskStage
    if (!title || !stage) return
    setNewTaskStage(null)
    run(() => roadmapApi.createTask({
      stage_id: stage.id,
      title,
      due_date: newTaskDueDate || null,
    }))
  }
  const removeTask = async (t: RoadmapTask) => {
    if (busy || !window.confirm('Удалить задачу?')) return
    setBusy(true)
    try {
      await roadmapApi.deleteTask(t.id)
      const rm = await roadmapApi.getRoadmap(roadmap.id)
      if (rm) onChanged(rm)
    } finally {
      setBusy(false)
    }
  }
  const addSubtask = (t: RoadmapTask) => {
    const title = window.prompt('Название подзадачи')?.trim()
    if (!title) return
    const dueDate = window.prompt('Срок подзадачи (ГГГГ-ММ-ДД, необязательно)')?.trim()
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      toast({ title: 'Введите срок в формате ГГГГ-ММ-ДД', variant: 'destructive' })
      return
    }
    run(() => roadmapApi.createSubtask(t.id, title, dueDate || null))
  }
  const removeSubtask = async (subId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await roadmapApi.deleteSubtask(subId)
      const rm = await roadmapApi.getRoadmap(roadmap.id)
      if (rm) onChanged(rm)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="label-caps text-gray-500 mb-1.5">Дорожная карта</p>
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">{roadmap.name}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {[roadmap.country_name, roadmap.degree, roadmap.year].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="text-right min-w-[160px]">
          <div className="text-2xl font-bold tabular-nums text-gray-900">
            {pct}
            <span className="text-base text-gray-400 font-semibold">%</span>
          </div>
          <div className="h-1.5 rounded bg-gray-100 overflow-hidden mt-1.5">
            <div className="h-full bg-brand rounded" style={{ width: `${pct}%` }} />
          </div>
          <p className="label-caps text-gray-400 mt-1.5">
            {done} / {total} задач
          </p>
        </div>
      </div>

      {/* stages */}
      <div>
        {roadmap.stages.map((s, idx) => {
          const isOpen = !!open[s.id]
          const isLast = idx === roadmap.stages.length - 1
          return (
            <div key={s.id} className="relative pl-9 pb-3">
              {!isLast && (
                <span
                  className={cn(
                    'absolute left-[10px] top-6 -bottom-1 w-0.5',
                    s.status === 'done' || s.status === 'in_progress' ? 'bg-brand' : 'bg-gray-200'
                  )}
                />
              )}
              <StageNode status={s.status} onClick={() => cycleStage(s)} />

              <div
                className="flex items-center gap-2.5 cursor-pointer select-none py-0.5"
                onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
              >
                <span
                  className={cn(
                    'text-[15px] font-semibold tracking-tight',
                    s.status === 'done' ? 'text-gray-500' : 'text-gray-900'
                  )}
                >
                  {s.name}
                </span>
                <StatusPill status={s.status} colorPrefix="ds" showIcon={false} />
                <span className="text-xs font-bold text-p-muted2 tabular-nums">
                  {s.tasks.filter((t) => t.status === 'done').length}/{s.tasks.length}
                </span>
                {!s.visible_to_student && (
                  <span className="rounded-pill bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">
                    скрыт от студента
                  </span>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleStageVisibility(s) }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                    title={s.visible_to_student ? 'Скрыть этап от студента' : 'Показать этап студенту'}
                    aria-label={s.visible_to_student ? 'Скрыть этап от студента' : 'Показать этап студенту'}
                  >
                    {s.visible_to_student ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                )}
                <ChevronRight
                  className={cn('w-4 h-4 text-gray-400 ml-auto transition-transform', isOpen && 'rotate-90')}
                />
              </div>

              {isOpen && (
                <div className="mt-2.5 space-y-2">
                  {s.tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      canManage={canManage}
                      onToggle={() => toggleTask(t)}
                      onToggleVisibility={() => toggleTaskVisibility(t)}
                      onToggleSub={toggleSubtask}
                      onUpdateDate={(dueDate) => run(() => roadmapApi.updateTask(t.id, { due_date: dueDate }))}
                      onUpdateSubDate={(id, dueDate) => run(() => roadmapApi.updateSubtask(id, { due_date: dueDate || null }))}
                      onAddSub={() => addSubtask(t)}
                      onRemove={() => removeTask(t)}
                      onRemoveSub={removeSubtask}
                    />
                  ))}
                  {s.tasks.length === 0 && (
                    <p className="text-sm text-gray-400 py-1">Задач пока нет</p>
                  )}
                  {canManage && (
                    <button
                      onClick={() => openAddTask(s)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black px-2 py-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" /> Добавить задачу
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Dialog open={Boolean(uncheckTask)} onOpenChange={(o) => !o && setUncheckTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Снять отметку о выполнении</DialogTitle>
            <DialogDescription>
              «{uncheckTask?.title}» вернётся в работу.
              {uncheckTask?.review_status === 'approved' && ' Подтверждение заявки студента будет снято.'}
              {' '}Если этап уже завершён, он тоже вернётся в работу.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <AppButton colorPrefix="ds" variant="subtle" size="sm" onClick={() => setUncheckTask(null)}>
              Отмена
            </AppButton>
            <AppButton
              colorPrefix="ds"
              size="sm"
              disabled={busy}
              onClick={() => uncheckTask && confirmUncheck(uncheckTask)}
            >
              Снять отметку
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(newTaskStage)} onOpenChange={(o) => !o && setNewTaskStage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
            <DialogDescription>
              Этап «{newTaskStage?.name}». Срок необязателен, но именно по нему считается срочность.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Название</Label>
              <Input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Что нужно сделать"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label>Срок</Label>
              <Input
                type="date"
                value={newTaskDueDate}
                onChange={(e) => setNewTaskDueDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <AppButton variant="subtle" size="sm" onClick={() => setNewTaskStage(null)}>
              Отмена
            </AppButton>
            <AppButton size="sm" disabled={!newTaskTitle.trim() || busy} onClick={submitAddTask}>
              Создать задачу
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const StageNode: React.FC<{ status: ItemStatus; onClick: () => void }> = ({ status, onClick }) => (
  <button
    onClick={onClick}
    title="Сменить статус этапа"
    className={cn(
      'absolute left-0 top-1 w-[21px] h-[21px] rounded-full grid place-items-center border-2',
      status === 'done' && 'bg-sidebar border-sidebar text-brand',
      status === 'in_progress' && 'bg-brand border-brand text-brand-ink ring-4 ring-brand/20',
      status === 'planned' && 'bg-white border-gray-300 text-transparent'
    )}
  >
    {status === 'done' ? (
      <Check className="w-3 h-3" strokeWidth={3.2} />
    ) : status === 'in_progress' ? (
      <Clock className="w-3 h-3" strokeWidth={2.6} />
    ) : (
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
    )}
  </button>
)

const TaskRow: React.FC<{
  task: RoadmapTask
  canManage: boolean
  onToggle: () => void
  onToggleVisibility: () => void
  onToggleSub: (id: string, isDone: boolean) => void
  onUpdateDate: (dueDate: string | null) => void
  onUpdateSubDate: (id: string, dueDate: string | null) => void
  onAddSub: () => void
  onRemove: () => void
  onRemoveSub: (id: string) => void
}> = ({ task, canManage, onToggle, onToggleVisibility, onToggleSub, onUpdateDate, onUpdateSubDate, onAddSub, onRemove, onRemoveSub }) => {
  const isDone = task.status === 'done'
  const taskOverdue = overdueDaysOf(task, isDone)
  return (
    <div className={cn('border rounded-[13px] bg-p-bg transition hover:translate-x-[3px]', taskOverdue > 0 ? 'border-ds-danger/60 bg-ds-danger/5' : 'border-p-line hover:border-p-accent-dim')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-[18px] py-[15px] sm:flex-nowrap">
        <button
          onClick={onToggle}
          className={cn(
            'w-[22px] h-[22px] rounded-md grid place-items-center border-2 shrink-0 mt-0.5 transition',
            isDone ? 'bg-brand border-brand text-brand-ink' : 'border-p-muted2 text-transparent hover:border-p-accent-dim'
          )}
          aria-label={isDone ? 'Снять отметку' : 'Отметить готовым'}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </button>
        <div className="min-w-[10rem] flex-1">
          <div
            className={cn(
              'text-sm font-bold',
              isDone ? 'line-through text-p-muted2' : 'text-p-text'
            )}
          >
            {task.title}
          </div>
          {task.description && (
            <div className="mt-1 line-clamp-2 text-xs text-p-muted">{task.description}</div>
          )}
          {task.expected_result && (
            <div className="mt-1 text-xs text-p-muted">
              <span className="font-bold text-p-text">Результат:</span> {task.expected_result}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-p-muted flex-wrap">
            {task.audience === 'coordinator' && <span className="text-p-muted2">координатор</span>}
            {!task.visible_to_student && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-2xs font-bold text-gray-500">
                скрыта от студента
              </span>
            )}
            {/* Заявка студента: галочка здесь = подтверждение — пусть это будет видно */}
            {task.review_status === 'pending' && (
              <span className="rounded-full border border-brand/50 bg-brand/10 px-2 py-0.5 text-2xs font-bold text-brand">
                ждёт проверки · галочка = подтвердить
              </span>
            )}
          </div>
        </div>
        <PriorityPill priority={task.priority} colorPrefix="ds" showIcon={false} className="shrink-0" />
        {canManage && (
          <button
            onClick={onToggleVisibility}
            className="shrink-0 text-p-muted2 transition hover:text-p-text"
            title={task.visible_to_student ? 'Скрыть задачу от студента' : 'Показать задачу студенту'}
            aria-label={task.visible_to_student ? 'Скрыть задачу от студента' : 'Показать задачу студенту'}
          >
            {task.visible_to_student ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        )}
        {canManage && (
          <button onClick={onRemove} className="text-p-muted2 hover:text-ds-danger shrink-0" aria-label="Удалить задачу">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {(task.due_date || canManage) && (
        <div className="-mt-2 flex justify-end px-[18px] pb-2.5 sm:pl-[52px]">
          <DeadlineField
            dueDate={task.due_date}
            overdueDays={taskOverdue}
            onChange={canManage ? onUpdateDate : undefined}
            label={`Срок задачи «${task.title}»`}
          />
        </div>
      )}

      {(task.subtasks.length > 0 || canManage) && (
        <div className="border-t border-p-line px-[18px] py-2.5 pl-10 sm:pl-[52px] space-y-1.5">
          {sortSubtasksByDeadline(task.subtasks).map((st) => (
            <div key={st.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 group">
              <button
                onClick={() => onToggleSub(st.id, st.is_done)}
                className={cn(
                  'w-[18px] h-[18px] rounded-[5px] border-2 grid place-items-center shrink-0 transition',
                  st.is_done ? 'bg-brand border-brand text-brand-ink' : 'border-p-muted2 text-transparent hover:border-p-accent-dim'
                )}
                aria-label={st.is_done ? 'Снять отметку' : 'Отметить'}
              >
                <Check className="w-3 h-3" strokeWidth={3} />
              </button>
              <span className={cn('min-w-[7rem] flex-1 text-xs', st.is_done ? 'line-through text-p-muted2' : 'text-p-muted')}>
                {st.title}
              </span>
              {canManage && (
                <button
                  onClick={() => onRemoveSub(st.id)}
                  className="text-p-muted2 hover:text-ds-danger opacity-0 group-hover:opacity-100"
                  aria-label="Удалить подзадачу"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <DeadlineField
                className="ml-auto"
                subtle
                dueDate={st.due_date}
                overdueDays={overdueDaysOf(st, st.is_done)}
                taskDueDate={task.due_date}
                onChange={canManage ? (dueDate) => onUpdateSubDate(st.id, dueDate) : undefined}
                label={`Срок подзадачи «${st.title}»`}
              />
            </div>
          ))}
          {canManage && (
            <button
              onClick={onAddSub}
              className="inline-flex items-center gap-1 text-xs font-medium text-p-muted hover:text-p-text"
            >
              <Plus className="w-3 h-3" /> подзадача
            </button>
          )}
        </div>
      )}
    </div>
  )
}
