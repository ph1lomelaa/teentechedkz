import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, ChevronRight, ClipboardList, Clock, Eye, EyeOff, FileUp, GripVertical, Pencil, Plus, Video, X } from 'lucide-react'
import {
  roadmapApi,
  Roadmap,
  RoadmapStage,
  RoadmapTask,
  ItemStatus,
  Priority,
  Audience,
} from '@/api/roadmap'
import { WorkspaceQuestionnaireDialog } from '@/components/workspace/WorkspaceQuestionnaireDialog'
import { AppButton, Pill, PriorityPill, StatusPill } from '@/components/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Input } from '@/components/ui/primitives/input'
import { Label } from '@/components/ui/primitives/label'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/primitives/toast'
import { withViewTransition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { DeadlineField } from '@/components/shared/DeadlineField'
import { overdueDaysOf } from '@/lib/roadmapDeadline'
import { useTheme } from '@/contexts/ThemeContext'

// Workspace-native interactive roadmap editor. Same roadmapApi mutations the CRM
// uses (RoadmapTimeline), restyled with the dark w-* tokens so the mentor manages
// stages/tasks/subtasks in place — no jump to the CRM card.

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

export const WorkspaceRoadmapEditor: React.FC<{
  roadmap: Roadmap
  canManage?: boolean
  onChanged: (updated: Roadmap) => void
}> = ({ roadmap, canManage = true, onChanged }) => {
  const { theme } = useTheme()
  const { total, done, pct } = useMemo(() => taskCounts(roadmap), [roadmap])
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [qTask, setQTask] = useState<{ id: string; title: string } | null>(null)
  const [returnTask, setReturnTask] = useState<RoadmapTask | null>(null)
  const [uncheckTask, setUncheckTask] = useState<RoadmapTask | null>(null)
  const [returnComment, setReturnComment] = useState('')
  const [newTaskStage, setNewTaskStage] = useState<RoadmapStage | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDueDate, setNewTaskDueDate] = useState('')
  const [subtaskParent, setSubtaskParent] = useState<RoadmapTask | null>(null)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskDueDate, setSubtaskDueDate] = useState('')
  const [deleteTask, setDeleteTask] = useState<RoadmapTask | null>(null)
  const [editTask, setEditTask] = useState<RoadmapTask | null>(null)
  const [editDraft, setEditDraft] = useState({
    title: '', description: '', expected_result: '', priority: 'required' as Priority,
    audience: 'applicant' as Audience, needs_document: false, needs_zoom: false, due_date: '',
  })
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    const current =
      roadmap.stages.find((s) => s.status === 'in_progress') ||
      roadmap.stages.find((s) => s.status !== 'done')
    if (current) initial[current.id] = true
    return initial
  })

  const run = async (fn: () => Promise<Roadmap>, onSuccess?: () => void) => {
    if (busy) return
    setBusy(true)
    try {
      const updated = await fn()
      // Кроссфейд перестройки: галочки, счётчики done/total и статус-пиллы
      // меняются плавно, а не одним кадром.
      withViewTransition(() => onChanged(updated))
      onSuccess?.()
    } catch (err) {
      const response = (err as {
        response?: { status?: number; headers?: Record<string, string>; data?: { detail?: { message?: string; missing_roles?: string[] } | string }
      } })?.response
      const detail = response?.data?.detail
      const missingRoles = typeof detail === 'object' ? detail.missing_roles : undefined
      // 404 — почти всегда устаревший экран: этап или задачу уже удалили в
      // другой вкладке. Сырое «Not found» от API пользователю ничего не
      // объясняет, поэтому пишем причину и перечитываем roadmap.
      const isStale = response?.status === 404
      toast({
        title: response?.headers?.['x-error-code'] === 'STAGE_REQUIRED_TEAM_INCOMPLETE'
          ? 'Этап ещё нельзя начать'
          : isStale
            ? 'Данные устарели'
            : 'Не удалось обновить этап',
        description: isStale
          ? 'Этап или задача уже изменены. Обновляем список.'
          : missingRoles?.length
            ? `Не допущены роли: ${missingRoles.join(', ')}`
            : typeof detail === 'object' ? detail.message : detail,
        variant: 'destructive',
      })
      if (isStale) {
        try {
          const fresh = await roadmapApi.getRoadmap(roadmap.id)
          withViewTransition(() => onChanged(fresh))
        } catch {
          /* следующий рефетч восстановит состояние */
        }
      }
    } finally {
      setBusy(false)
    }
  }

  // Снятие отметки — подтверждаемое действие: оно откатывает и сам этап, если
  // тот уже был завершён, а при подтверждённой заявке студента ещё и стирает
  // штампы ревью. Случайный клик по галочке не должен всё это делать молча.
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

  // Ревью заявки студента (T3/T4). API возвращает полный обновлённый Roadmap —
  // тот же контракт, что у остальных мутаций редактора. 409 (гонка со снятием
  // заявки или чужим ревью) — нейтральный toast + перечитываем правду.
  const reviewTask = async (t: RoadmapTask, action: 'approve' | 'return', comment?: string) => {
    if (busy) return
    setBusy(true)
    try {
      const updated = await roadmapApi.reviewTask(t.id, comment ? { action, comment } : { action })
      setReturnTask(null)
      // Чип «ждёт проверки» и инлайн-кнопки растворяются, а не исчезают рывком.
      withViewTransition(() => onChanged(updated))
      toast({ title: action === 'approve' ? 'Задача подтверждена' : 'Задача возвращена студенту' })
    } catch (err) {
      setReturnTask(null)
      const status = (err as { response?: { status?: number } })?.response?.status
      toast({
        title: status === 409 ? 'Задача уже разобрана' : 'Не удалось выполнить ревью',
        variant: 'destructive',
      })
      try {
        const fresh = await roadmapApi.getRoadmap(roadmap.id)
        withViewTransition(() => onChanged(fresh))
      } catch {
        /* следующий рефетч восстановит состояние */
      }
    } finally {
      setBusy(false)
      queryClient.invalidateQueries({ queryKey: ['workspace', 'review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'review-count'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'dashboard'] })
    }
  }
  const toggleSubtask = (subId: string, isDone: boolean) =>
    run(() => roadmapApi.updateSubtask(subId, { is_done: !isDone }))
  const cycleStage = (s: RoadmapStage) => {
    const nextStatus = STAGE_CYCLE[s.status]
    if (nextStatus === 'done' && !s.can_complete) {
      toast({
        title: 'Этап ещё нельзя закрыть',
        description: `Принято обязательных задач: ${s.required_done}/${s.required_total}`,
        variant: 'destructive',
      })
      return
    }
    return run(() => roadmapApi.updateStage(s.id, { status: nextStatus }))
  }

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
  const openEditTask = (task: RoadmapTask) => {
    setEditTask(task)
    setEditDraft({
      title: task.title,
      description: task.description || '',
      expected_result: task.expected_result || '',
      priority: task.priority,
      audience: task.audience,
      needs_document: task.needs_document,
      needs_zoom: task.needs_zoom,
      due_date: task.due_date || '',
    })
  }
  const submitEditTask = () => {
    const task = editTask
    const title = editDraft.title.trim()
    if (!task || !title) return
    run(() => roadmapApi.updateTask(task.id, {
      title,
      description: editDraft.description.trim(),
      expected_result: editDraft.expected_result.trim(),
      priority: editDraft.priority,
      audience: editDraft.audience,
      needs_document: editDraft.needs_document,
      needs_zoom: editDraft.needs_zoom,
      due_date: editDraft.due_date || null,
    }), () => setEditTask(null))
  }
  const openAddSubtask = (t: RoadmapTask) => {
    setSubtaskParent(t)
    setSubtaskTitle('')
    setSubtaskDueDate('')
  }
  const submitAddSubtask = () => {
    const title = subtaskTitle.trim()
    const parent = subtaskParent
    if (!title || !parent) return
    setSubtaskParent(null)
    run(() => roadmapApi.createSubtask(parent.id, title, subtaskDueDate || null))
  }
  const removeTask = async (t: RoadmapTask) => {
    setDeleteTask(null)
    // Через общий run: раньше свой try/finally глотал ошибку, и удаление уже
    // удалённой задачи всплывало сырым «Not found» из соседнего обработчика.
    run(async () => {
      await roadmapApi.deleteTask(t.id)
      return roadmapApi.getRoadmap(roadmap.id)
    }, () => toast({ title: `Удалена задача «${t.title}»`, duration: 5000, action: <ToastAction altText="Отменить удаление задачи" onClick={() => run(() => roadmapApi.restoreTask(t.id))}>Отменить</ToastAction> }))
  }
  const removeSubtask = async (subId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await roadmapApi.deleteSubtask(subId)
      const rm = await roadmapApi.getRoadmap(roadmap.id)
      if (rm) withViewTransition(() => onChanged(rm))
      toast({ title: 'Подзадача удалена', duration: 5000, action: <ToastAction altText="Отменить удаление подзадачи" onClick={() => run(() => roadmapApi.restoreSubtask(subId))}>Отменить</ToastAction> })
    } catch (error) {
      toast({ title: 'Не удалось удалить подзадачу', description: String(error), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className={cn('transition-opacity', busy && 'pointer-events-none opacity-60')}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-w-muted">
          Прогресс · {done}/{total} задач
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-w-panel2">
            <div
              className="h-full rounded-full bg-w-accent transition-all motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="font-display text-sm font-black tabular-nums text-w-ink">{pct}%</div>
        </div>
      </div>

      <div>
        {roadmap.stages.map((s, idx) => {
          const isOpen = !!open[s.id]
          const isLast = idx === roadmap.stages.length - 1
          const stageDone = s.tasks.filter((t) => t.status === 'done').length
          return (
            <div key={s.id} className="relative pl-9 pb-3">
              {!isLast && (
                <span
                  className={cn(
                    'absolute left-[10px] top-7 -bottom-1 w-0.5',
                    s.status === 'done' || s.status === 'in_progress' ? 'bg-w-accentDim' : 'bg-w-line'
                  )}
                />
              )}
              <StageNode
                status={s.status}
                onClick={() => canManage && cycleStage(s)}
                disabled={!canManage || (STAGE_CYCLE[s.status] === 'done' && !s.can_complete)}
              />

              <div
                className="flex cursor-pointer select-none flex-wrap items-center gap-x-2.5 gap-y-1 py-1"
                onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
              >
                <span
                  className={cn(
                    'min-w-0 break-words text-[15px] font-black tracking-tight',
                    s.status === 'done' ? 'text-w-muted' : 'text-w-ink'
                  )}
                >
                  {s.name}
                </span>
                <StatusPill status={s.status} colorPrefix="w" />
                <span className="text-xs font-bold text-w-muted2">
                  {stageDone}/{s.tasks.length}
                </span>
                {s.required_total > 0 && (
                  <span className={cn('text-[11px] font-bold', s.can_complete ? 'text-w-good' : 'text-w-muted2')}>
                    обязательные {s.required_done}/{s.required_total}
                  </span>
                )}
                {!s.visible_to_student && (
                  <Pill colorPrefix="w" tone="neutral">скрыт от студента</Pill>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleStageVisibility(s) }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-w-muted2 transition hover:bg-w-panel2 hover:text-w-ink"
                    title={s.visible_to_student ? 'Скрыть этап от студента' : 'Показать этап студенту'}
                    aria-label={s.visible_to_student ? 'Скрыть этап от студента' : 'Показать этап студенту'}
                  >
                    {s.visible_to_student ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                )}
                <ChevronRight
                  className={cn('ml-auto h-4 w-4 text-w-muted2 transition-transform', isOpen && 'rotate-90')}
                />
              </div>

              {/* Контент этапа всегда смонтирован: высота анимируется 0fr→1fr. */}
              <div className="expandable" data-open={isOpen}>
                <div>
                  <div className="space-y-2 pt-2">
                    {s.tasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        canManage={canManage}
                        onToggle={() => toggleTask(t)}
                        onToggleVisibility={() => toggleTaskVisibility(t)}
                        onToggleSub={toggleSubtask}
                        onUpdateDate={(dueDate) => run(() => roadmapApi.updateTask(t.id, { due_date: dueDate }))}
                        onEdit={() => openEditTask(t)}
                        onUpdateTask={(body) => run(() => roadmapApi.updateTask(t.id, body))}
                        onUpdateSubTitle={(id, title) => run(() => roadmapApi.updateSubtask(id, { title }))}
                        onReorderSubs={(ids) => run(async () => {
                          let updated = roadmap
                          for (let index = 0; index < ids.length; index += 1) updated = await roadmapApi.updateSubtask(ids[index], { position: index })
                          return updated
                        })}
                        onCreateSub={(title) => run(() => roadmapApi.createSubtask(t.id, title))}
                        onAddSub={() => openAddSubtask(t)}
                        onUpdateSubDate={(id, dueDate) => run(() => roadmapApi.updateSubtask(id, { due_date: dueDate || null }))}
                        onRemove={() => setDeleteTask(t)}
                        onRemoveSub={removeSubtask}
                        onOpenQuestionnaire={() => setQTask({ id: t.id, title: t.title })}
                        onApproveReview={() => reviewTask(t, 'approve')}
                        onReturnReview={() => {
                          setReturnComment('')
                          setReturnTask(t)
                        }}
                      />
                    ))}
                    {s.tasks.length === 0 && (
                      <p className="py-1 text-sm text-w-muted2">Задач пока нет</p>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => openAddTask(s)}
                        className="inline-flex items-center gap-1.5 rounded-ctl px-2 py-1.5 text-xs font-bold text-w-muted transition hover:text-w-accentText"
                      >
                        <Plus className="h-3.5 w-3.5" /> Добавить задачу
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
    {qTask && (
      <WorkspaceQuestionnaireDialog
        taskId={qTask.id}
        taskTitle={qTask.title}
        studentId={roadmap.student_id}
        open
        onClose={() => setQTask(null)}
      />
    )}
    <Dialog open={Boolean(uncheckTask)} onOpenChange={(o) => !o && setUncheckTask(null)}>
      <DialogContent className="portal border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-w-ink">Снять отметку о выполнении</DialogTitle>
          <DialogDescription className="text-w-muted">
            «{uncheckTask?.title}» вернётся в работу.
            {uncheckTask?.review_status === 'approved' && ' Подтверждение заявки студента будет снято.'}
            {' '}Если этап уже завершён, он тоже вернётся в работу.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setUncheckTask(null)}>
            Отмена
          </AppButton>
          <AppButton
            colorPrefix="w"
            size="sm"
            className="active:scale-[0.98]"
            disabled={busy}
            onClick={() => uncheckTask && confirmUncheck(uncheckTask)}
          >
            Снять отметку
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(returnTask)} onOpenChange={(o) => !o && setReturnTask(null)}>
      <DialogContent className="portal border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-w-ink">Вернуть задачу студенту</DialogTitle>
          <DialogDescription className="text-w-muted">
            «{returnTask?.title}». Комментарий обязателен — студент увидит его прямо на карточке задачи.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={returnComment}
          onChange={(e) => setReturnComment(e.target.value)}
          placeholder="Что доработать и почему"
          className="min-h-[110px] border-w-line bg-w-panel2 text-w-ink placeholder:text-w-muted2 focus-visible:border-w-accentDim focus-visible:ring-w-accentDim"
        />
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setReturnTask(null)}>
            Отмена
          </AppButton>
          <AppButton
            colorPrefix="w"
            size="sm"
            className="active:scale-[0.98]"
            disabled={!returnComment.trim() || busy}
            onClick={() => returnTask && reviewTask(returnTask, 'return', returnComment.trim())}
          >
            Вернуть с комментарием
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(newTaskStage)} onOpenChange={(o) => !o && setNewTaskStage(null)}>
      <DialogContent className="portal border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-w-ink">Новая задача</DialogTitle>
          <DialogDescription className="text-w-muted">
            Этап «{newTaskStage?.name}». Срок необязателен, но именно по нему считается срочность.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-w-muted">Название</Label>
            <Input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Что нужно сделать"
              className="mt-1 border-w-line bg-w-panel2 text-w-ink placeholder:text-w-muted2 focus-visible:border-w-accentDim focus-visible:ring-w-accentDim"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-w-muted">Срок</Label>
            <Input
              type="date"
              value={newTaskDueDate}
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              className="mt-1 border-w-line bg-w-panel2 text-w-ink focus-visible:border-w-accentDim focus-visible:ring-w-accentDim"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setNewTaskStage(null)}>
            Отмена
          </AppButton>
          <AppButton
            colorPrefix="w"
            size="sm"
            className="active:scale-[0.98]"
            disabled={!newTaskTitle.trim() || busy}
            onClick={submitAddTask}
          >
            Создать задачу
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(editTask)} onOpenChange={(o) => !o && setEditTask(null)}>
      <DialogContent data-theme={theme} className="portal max-h-[90dvh] overflow-y-auto border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-w-ink">Изменить задачу</DialogTitle>
          <DialogDescription className="text-w-muted">
            Правка применяется к этой задаче в roadmap студента. Исходный шаблон Notion не меняется.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="roadmap-task-edit-title" className="text-w-muted">Название</Label>
            <Input id="roadmap-task-edit-title" value={editDraft.title} onChange={(e) => setEditDraft((draft) => ({ ...draft, title: e.target.value }))}
              className="mt-1 border-w-line bg-w-panel2 text-w-ink focus-visible:border-w-accentDim focus-visible:ring-w-accentDim" />
          </div>
          <div>
            <Label htmlFor="roadmap-task-edit-description" className="text-w-muted">Описание</Label>
            <Textarea id="roadmap-task-edit-description" value={editDraft.description} onChange={(e) => setEditDraft((draft) => ({ ...draft, description: e.target.value }))}
              className="mt-1 border-w-line bg-w-panel2 text-w-ink focus-visible:border-w-accentDim focus-visible:ring-w-accentDim" />
          </div>
          <div>
            <Label htmlFor="roadmap-task-edit-result" className="text-w-muted">Ожидаемый результат</Label>
            <Textarea id="roadmap-task-edit-result" value={editDraft.expected_result} onChange={(e) => setEditDraft((draft) => ({ ...draft, expected_result: e.target.value }))}
              className="mt-1 border-w-line bg-w-panel2 text-w-ink focus-visible:border-w-accentDim focus-visible:ring-w-accentDim" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-w-muted">Приоритет
              <select value={editDraft.priority} onChange={(e) => setEditDraft((draft) => ({ ...draft, priority: e.target.value as Priority }))}
                className="mt-1 h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink">
                <option value="required">Обязательно</option><option value="recommended">Желательно</option><option value="optional">По желанию</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-w-muted">Для кого
              <select value={editDraft.audience} onChange={(e) => setEditDraft((draft) => ({ ...draft, audience: e.target.value as Audience }))}
                className="mt-1 h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink">
                <option value="applicant">Абитуриент</option><option value="coordinator">Координатор</option>
              </select>
            </label>
          </div>
          <div>
            <Label htmlFor="roadmap-task-edit-due-date" className="text-w-muted">Срок</Label>
            <Input id="roadmap-task-edit-due-date" type="date" value={editDraft.due_date} onChange={(e) => setEditDraft((draft) => ({ ...draft, due_date: e.target.value }))}
              className="mt-1 border-w-line bg-w-panel2 text-w-ink focus-visible:border-w-accentDim focus-visible:ring-w-accentDim" />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-w-ink">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.needs_document} onChange={(e) => setEditDraft((draft) => ({ ...draft, needs_document: e.target.checked }))} />Нужен документ</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.needs_zoom} onChange={(e) => setEditDraft((draft) => ({ ...draft, needs_zoom: e.target.checked }))} />Нужен Zoom</label>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setEditTask(null)}>Отмена</AppButton>
          <AppButton colorPrefix="w" size="sm" disabled={!editDraft.title.trim() || busy} onClick={submitEditTask}>Сохранить</AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Подзадача и удаление — свои диалоги вместо window.prompt/confirm:
        системные окна игнорируют тему платформы и выпадают из вёрстки. */}
    <Dialog open={Boolean(subtaskParent)} onOpenChange={(o) => !o && setSubtaskParent(null)}>
      <DialogContent className="portal border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-w-ink">Новая подзадача</DialogTitle>
          <DialogDescription className="text-w-muted">
            Внутри задачи «{subtaskParent?.title}».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-w-muted">Название</Label>
            <Input
              value={subtaskTitle}
              onChange={(e) => setSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && subtaskTitle.trim()) submitAddSubtask()
              }}
              placeholder="Что нужно сделать"
              className="mt-1 border-w-line bg-w-panel2 text-w-ink placeholder:text-w-muted2 focus-visible:border-w-accentDim focus-visible:ring-w-accentDim"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-w-muted">Отдельный дедлайн</Label>
            <Input
              type="date"
              value={subtaskDueDate}
              onChange={(e) => setSubtaskDueDate(e.target.value)}
              className="mt-1 border-w-line bg-w-panel2 text-w-ink focus-visible:border-w-accentDim focus-visible:ring-w-accentDim"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setSubtaskParent(null)}>
            Отмена
          </AppButton>
          <AppButton
            colorPrefix="w"
            size="sm"
            className="active:scale-[0.98]"
            disabled={!subtaskTitle.trim() || busy}
            onClick={submitAddSubtask}
          >
            Добавить
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(deleteTask)} onOpenChange={(o) => !o && setDeleteTask(null)}>
      <DialogContent className="portal border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-w-ink">Удалить задачу?</DialogTitle>
          <DialogDescription className="text-w-muted">
            «{deleteTask?.title}» и её подзадачи будут удалены безвозвратно.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setDeleteTask(null)}>
            Отмена
          </AppButton>
          <AppButton
            colorPrefix="w"
            variant="danger"
            size="sm"
            className="active:scale-[0.98]"
            disabled={busy}
            onClick={() => deleteTask && removeTask(deleteTask)}
          >
            Удалить
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

const StageNode: React.FC<{ status: ItemStatus; onClick: () => void; disabled?: boolean }> = ({ status, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title="Сменить статус этапа"
    className={cn(
      'absolute left-0 top-1.5 grid h-[21px] w-[21px] place-items-center rounded-full border-2 transition active:scale-[0.98]',
      status === 'done' && 'border-w-good bg-w-good text-black',
      status === 'in_progress' && 'border-w-accent bg-w-accent text-black ring-4 ring-w-accent/20',
      status === 'planned' && 'border-w-line bg-w-panel text-transparent',
      disabled && 'cursor-default'
    )}
  >
    {status === 'done' ? (
      <Check className="h-3 w-3" strokeWidth={3.2} />
    ) : status === 'in_progress' ? (
      <Clock className="h-3 w-3" strokeWidth={2.6} />
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-w-muted2" />
    )}
  </button>
)

const InlineField: React.FC<{ value: string; canEdit: boolean; onSave: (value: string) => void; label: string; className?: string; multiline?: boolean; required?: boolean; emptyLabel?: string }> = ({ value, canEdit, onSave, label, className, multiline, required, emptyLabel }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const skipBlur = useRef(false)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) { skipBlur.current = false; input.current?.select() } }, [editing])
  useEffect(() => { if (editing && input.current instanceof HTMLTextAreaElement) { input.current.style.height = 'auto'; input.current.style.height = `${input.current.scrollHeight}px` } }, [draft, editing])
  const save = () => {
    if (skipBlur.current) { skipBlur.current = false; return }
    const next = draft.trim()
    setEditing(false)
    if (next !== value && (!required || next)) onSave(next)
  }
  if (!canEdit && !value) return null
  if (!editing) return canEdit ? <button type="button" onClick={() => setEditing(true)} className={cn('max-w-full whitespace-pre-wrap text-left hover:underline focus-visible:outline-2 focus-visible:outline-w-accent', className)} aria-label={`Изменить: ${label}`}>{value || emptyLabel}</button> : <span className={cn('whitespace-pre-wrap', className)}>{value}</span>
  const common = { ref: input, value: draft, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value), onBlur: save, onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (event.key === 'Escape') { skipBlur.current = true; setEditing(false); setDraft(value) } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); skipBlur.current = true } }, 'aria-label': label, className: 'w-full rounded-ctl border border-w-accentDim bg-w-panel px-2 py-1 text-sm text-w-ink outline-none focus:border-w-accent' }
  return multiline ? <textarea {...common} rows={Math.max(2, draft.split('\n').length)} /> : <input {...common} />
}

const TaskCard: React.FC<{
  task: RoadmapTask
  canManage: boolean
  onToggle: () => void
  onToggleVisibility: () => void
  onToggleSub: (id: string, isDone: boolean) => void
  onUpdateDate: (dueDate: string | null) => void
  onEdit: () => void
  onUpdateTask: (body: Parameters<typeof roadmapApi.updateTask>[1]) => void
  onUpdateSubTitle: (id: string, title: string) => void
  onReorderSubs: (ids: string[]) => void
  onCreateSub: (title: string) => void
  onAddSub: () => void
  onUpdateSubDate: (id: string, dueDate: string | null) => void
  onRemove: () => void
  onRemoveSub: (id: string) => void
  onOpenQuestionnaire?: () => void
  onApproveReview?: () => void
  onReturnReview?: () => void
}> = ({ task, canManage, onToggle, onToggleVisibility, onToggleSub, onUpdateDate, onEdit, onUpdateTask, onUpdateSubTitle, onReorderSubs, onCreateSub, onUpdateSubDate, onAddSub, onRemove, onRemoveSub, onOpenQuestionnaire, onApproveReview, onReturnReview }) => {
  const [addingSub, setAddingSub] = useState(false)
  const [newSubTitle, setNewSubTitle] = useState('')
  const [confirmSub, setConfirmSub] = useState<string | null>(null)
  const [dragSub, setDragSub] = useState<string | null>(null)
  const orderedSubs = [...task.subtasks].sort((a, b) => a.position - b.position)
  const move = (from: string, to: string) => {
    if (from === to) return
    const ids = orderedSubs.map(sub => sub.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(to), 0, from)
    onReorderSubs(ids)
  }
  const addSub = () => {
    const title = newSubTitle.trim()
    if (!title) return
    onCreateSub(title)
    setNewSubTitle('')
  }
  const isDone = task.status === 'done'
  const taskOverdue = overdueDaysOf(task, isDone)
  return (
    <div className={cn('rounded-[13px] border bg-w-panel2 transition hover:translate-x-[3px]', taskOverdue > 0 ? 'border-w-danger/60 bg-w-danger/5' : 'border-w-line hover:border-w-accentDim')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-[18px] py-[15px] sm:flex-nowrap">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border-2 transition active:scale-[0.98]',
            isDone ? 'border-w-good bg-w-good text-black' : 'border-w-line text-transparent hover:border-w-accentDim'
          )}
          aria-label={isDone ? 'Снять отметку' : 'Отметить готовым'}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </button>
        <div className="min-w-[10rem] flex-1">
          <InlineField value={task.title} canEdit={canManage} required className={cn('text-sm font-bold', isDone ? 'text-w-muted line-through' : 'text-w-ink')} onSave={title => onUpdateTask({ title })} label="Название задачи" />
          <div className="mt-1"><InlineField value={task.description} canEdit={canManage} multiline emptyLabel="+ описание" className="text-xs text-w-muted" onSave={description => onUpdateTask({ description })} label="Описание задачи" /></div>
          {(canManage || task.expected_result) && <div className="mt-1 text-xs text-w-muted">{task.expected_result && <span className="font-bold text-w-ink">Результат: </span>}<InlineField value={task.expected_result} canEdit={canManage} multiline emptyLabel="+ результат" className="text-xs text-w-muted" onSave={expected_result => onUpdateTask({ expected_result })} label="Результат задачи" /></div>}
          {task.review_status === 'returned' && task.review_comment && (
            <div className="mt-1 text-xs text-w-muted">
              <span className="font-bold text-w-ink">Комментарий ментора:</span> {task.review_comment}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-w-muted">
            {!task.visible_to_student && (
              <Pill colorPrefix="w" tone="neutral">скрыта от студента</Pill>
            )}
            {task.review_status === 'pending' && (
              <Pill colorPrefix="w" tone="accent">ждёт проверки</Pill>
            )}
            {task.review_status === 'returned' && (
              <Pill colorPrefix="w" tone="neutral" className="bg-w-danger/15 text-w-danger">возвращена</Pill>
            )}
            {task.review_status === 'pending' && canManage && (
              <>
                <button
                  type="button"
                  onClick={onApproveReview}
                  className="inline-flex items-center gap-1 rounded-full border border-w-good/50 px-2 py-0.5 text-2xs font-bold text-w-good transition hover:bg-w-good/10 active:scale-[0.98]"
                >
                  <Check className="h-3 w-3" strokeWidth={3} /> Подтвердить
                </button>
                <button
                  type="button"
                  onClick={onReturnReview}
                  className="inline-flex items-center gap-1 rounded-full border border-w-line px-2 py-0.5 text-2xs font-bold text-w-muted transition hover:border-w-danger/50 hover:text-w-danger active:scale-[0.98]"
                >
                  Вернуть
                </button>
              </>
            )}
            {task.audience === 'coordinator' && <span className="text-w-muted2">координатор</span>}
            {task.needs_document && (
              <span className="inline-flex items-center gap-1 text-2xs text-w-muted2"><FileUp className="h-3 w-3" /> документ</span>
            )}
            {task.needs_zoom && (
              <span className="inline-flex items-center gap-1 text-2xs text-w-muted2"><Video className="h-3 w-3" /> zoom</span>
            )}
            {canManage ? (
              <button
                type="button"
                onClick={onOpenQuestionnaire}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-w-accentDim/50 px-2 py-0.5 text-2xs font-bold text-w-accentText transition hover:bg-w-accent/10"
              >
                <ClipboardList className="h-3 w-3" /> Анкета
              </button>
            ) : task.questionnaire_url ? (
              <a
                href={task.questionnaire_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-w-accentDim/50 px-2 py-0.5 text-2xs font-bold text-w-accentText transition hover:bg-w-accent/10"
              >
                <ClipboardList className="h-3 w-3" /> Анкета
              </a>
            ) : null}
          </div>
        </div>
        {canManage ? <button type="button" onClick={() => onUpdateTask({ priority: task.priority === 'required' ? 'optional' : 'required' })} title="Изменить обязательность" aria-label="Изменить обязательность"><PriorityPill priority={task.priority} colorPrefix="w" className="shrink-0" /></button> : <PriorityPill priority={task.priority} colorPrefix="w" className="shrink-0" />}
        {canManage && (
          <button type="button" onClick={onEdit} className="shrink-0 text-w-muted2 transition hover:text-w-accentText"
            aria-label={`Изменить задачу «${task.title}»`} title="Изменить задачу">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onToggleVisibility}
            className="shrink-0 text-w-muted2 transition hover:text-w-ink"
            title={task.visible_to_student ? 'Скрыть задачу от студента' : 'Показать задачу студенту'}
            aria-label={task.visible_to_student ? 'Скрыть задачу от студента' : 'Показать задачу студенту'}
          >
            {task.visible_to_student ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 text-w-muted2 transition hover:text-w-danger"
            aria-label="Удалить задачу"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {(task.due_date || canManage) && (
        <div className="-mt-2 flex justify-end px-[18px] pb-2.5 sm:pl-[52px]">
          <DeadlineField
            tone="w"
            dueDate={task.due_date}
            overdueDays={taskOverdue}
            done={isDone}
            onChange={canManage ? onUpdateDate : undefined}
            label={`Срок задачи «${task.title}»`}
          />
        </div>
      )}

      {(task.subtasks.length > 0 || canManage) && (
        <div className="space-y-1.5 border-t border-w-line px-[18px] py-2 pl-10 sm:pl-[52px]">
          {orderedSubs.map((st, index) => (
            <div key={st.id} className="group flex flex-wrap items-center gap-x-2 gap-y-1" onDragOver={event => { if (canManage) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (dragSub) move(dragSub, st.id); setDragSub(null) }}>
              {canManage && <span draggable onDragStart={() => setDragSub(st.id)} onDragEnd={() => setDragSub(null)} className="cursor-grab text-w-muted2" title="Перетащить подзадачу"><GripVertical className="h-3.5 w-3.5" /></span>}
              <button
                type="button"
                onClick={() => onToggleSub(st.id, st.is_done)}
                className={cn(
                  'grid h-[18px] w-[18px] shrink-0 place-items-center rounded border transition active:scale-[0.98]',
                  st.is_done ? 'border-w-good bg-w-good text-black' : 'border-w-line text-transparent hover:border-w-accentDim'
                )}
                aria-label={st.is_done ? 'Снять отметку' : 'Отметить'}
              >
                <Check className="h-3 w-3" strokeWidth={3.2} />
              </button>
              <InlineField value={st.title} canEdit={canManage} required className={cn('min-w-[7rem] flex-1 text-xs', st.is_done ? 'text-w-muted2 line-through' : 'text-w-ink/85')} onSave={title => onUpdateSubTitle(st.id, title)} label="Название подзадачи" />
              {canManage && <span className="flex items-center"><button type="button" disabled={index === 0} onClick={() => move(st.id, orderedSubs[index - 1].id)} aria-label="Переместить подзадачу выше" title="Выше" className="text-w-muted2 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button><button type="button" disabled={index === orderedSubs.length - 1} onClick={() => move(st.id, orderedSubs[index + 1].id)} aria-label="Переместить подзадачу ниже" title="Ниже" className="text-w-muted2 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button></span>}
              {canManage && (
                confirmSub === st.id ? <span className="text-xs text-w-danger">Удалить? <button onClick={() => { onRemoveSub(st.id); setConfirmSub(null) }} className="font-bold underline">Да</button> <button onClick={() => setConfirmSub(null)} className="underline">Нет</button></span> : <button
                  type="button"
                  onClick={() => setConfirmSub(st.id)}
                  className="text-w-muted2 opacity-0 transition hover:text-w-danger group-hover:opacity-100"
                  aria-label="Удалить подзадачу"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <DeadlineField
                tone="w"
                className="ml-auto"
                subtle
                dueDate={st.due_date}
                overdueDays={overdueDaysOf(st, st.is_done)}
                done={st.is_done}
                taskDueDate={task.due_date}
                onChange={canManage ? (dueDate) => onUpdateSubDate(st.id, dueDate) : undefined}
                label={`Срок подзадачи «${st.title}»`}
              />
            </div>
          ))}
          {canManage && (addingSub ? <input autoFocus value={newSubTitle} onChange={event => setNewSubTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addSub(); if (event.key === 'Escape') { setAddingSub(false); setNewSubTitle('') } }} placeholder="Название подзадачи" aria-label="Новая подзадача" className="w-full rounded-ctl border border-w-line bg-w-panel px-2 py-1 text-xs text-w-ink" /> :
            <button
              type="button"
              onClick={() => setAddingSub(true)}
              className="inline-flex items-center gap-1 text-2xs font-bold text-w-muted2 transition hover:text-w-accentText"
            >
              <Plus className="h-3 w-3" /> подзадача
            </button>
          )}
          {canManage && <button type="button" onClick={onAddSub} className="ml-3 text-2xs text-w-muted2 hover:text-w-accentText">+ подзадача со сроком</button>}
        </div>
      )}
    </div>
  )
}
