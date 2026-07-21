import React, { useMemo, useState } from 'react'
import { Check, ChevronRight, ClipboardList, Clock, FileUp, Plus, Video, X } from 'lucide-react'
import {
  roadmapApi,
  Roadmap,
  RoadmapStage,
  RoadmapTask,
  ItemStatus,
} from '@/api/roadmap'
import { WorkspaceQuestionnaireDialog } from '@/components/workspace/WorkspaceQuestionnaireDialog'
import { cn, formatDate } from '@/lib/utils'

// Workspace-native interactive roadmap editor. Same roadmapApi mutations the CRM
// uses (RoadmapTimeline), restyled with the dark w-* tokens so the mentor manages
// stages/tasks/subtasks in place — no jump to the CRM card.

const PRIORITY_LABEL: Record<string, string> = {
  required: 'Обязательно',
  recommended: 'Желательно',
  optional: 'По желанию',
}
const STAGE_STATUS_LABEL: Record<ItemStatus, string> = {
  planned: 'Впереди',
  in_progress: 'Сейчас',
  done: 'Пройдено',
}
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
  const { total, done, pct } = useMemo(() => taskCounts(roadmap), [roadmap])
  const [busy, setBusy] = useState(false)
  const [qTask, setQTask] = useState<{ id: string; title: string } | null>(null)
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
    } finally {
      setBusy(false)
    }
  }

  const toggleTask = (t: RoadmapTask) =>
    run(() => roadmapApi.updateTask(t.id, { status: t.status === 'done' ? 'planned' : 'done' }))
  const toggleSubtask = (subId: string, isDone: boolean) =>
    run(() => roadmapApi.updateSubtask(subId, { is_done: !isDone }))
  const cycleStage = (s: RoadmapStage) =>
    run(() => roadmapApi.updateStage(s.id, { status: STAGE_CYCLE[s.status] }))

  const addTask = (s: RoadmapStage) => {
    const title = window.prompt('Название задачи')?.trim()
    if (title) run(() => roadmapApi.createTask({ stage_id: s.id, title }))
  }
  const addSubtask = (t: RoadmapTask) => {
    const title = window.prompt('Название подзадачи')?.trim()
    if (title) run(() => roadmapApi.createSubtask(t.id, title))
  }
  const removeTask = async (t: RoadmapTask) => {
    if (busy || !window.confirm('Удалить задачу?')) return
    setBusy(true)
    try {
      await roadmapApi.deleteTask(t.id)
      const rm = await roadmapApi.studentRoadmap(roadmap.student_id)
      if (rm) onChanged(rm)
    } finally {
      setBusy(false)
    }
  }
  const removeSubtask = async (subId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await roadmapApi.deleteSubtask(subId)
      const rm = await roadmapApi.studentRoadmap(roadmap.student_id)
      if (rm) onChanged(rm)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className={cn(busy && 'pointer-events-none opacity-60')}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-w-muted">
          Прогресс · {done}/{total} задач
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-w-panel2">
            <div className="h-full rounded-full bg-w-accent transition-all" style={{ width: `${pct}%` }} />
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
              <StageNode status={s.status} onClick={() => canManage && cycleStage(s)} disabled={!canManage} />

              <div
                className="flex cursor-pointer select-none items-center gap-2.5 py-1"
                onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
              >
                <span
                  className={cn(
                    'text-[15px] font-black tracking-tight',
                    s.status === 'done' ? 'text-w-muted' : 'text-w-ink'
                  )}
                >
                  {s.name}
                </span>
                <StatusPill status={s.status} />
                <span className="text-[11px] font-bold text-w-muted2">
                  {stageDone}/{s.tasks.length}
                </span>
                <ChevronRight
                  className={cn('ml-auto h-4 w-4 text-w-muted2 transition-transform', isOpen && 'rotate-90')}
                />
              </div>

              {isOpen && (
                <div className="mt-2 space-y-2">
                  {s.tasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      canManage={canManage}
                      onToggle={() => toggleTask(t)}
                      onToggleSub={toggleSubtask}
                      onAddSub={() => addSubtask(t)}
                      onRemove={() => removeTask(t)}
                      onRemoveSub={removeSubtask}
                      onOpenQuestionnaire={() => setQTask({ id: t.id, title: t.title })}
                    />
                  ))}
                  {s.tasks.length === 0 && (
                    <p className="py-1 text-sm text-w-muted2">Задач пока нет</p>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => addTask(s)}
                      className="inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-xs font-bold text-w-muted transition hover:text-w-accentText"
                    >
                      <Plus className="h-3.5 w-3.5" /> Добавить задачу
                    </button>
                  )}
                </div>
              )}
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
      'absolute left-0 top-1.5 grid h-[21px] w-[21px] place-items-center rounded-full border-2 transition',
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

const StatusPill: React.FC<{ status: ItemStatus }> = ({ status }) => (
  <span
    className={cn(
      'rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider',
      status === 'done' && 'bg-w-panel2 text-w-muted',
      status === 'in_progress' && 'bg-w-accent text-black',
      status === 'planned' && 'border border-w-line text-w-muted2'
    )}
  >
    {STAGE_STATUS_LABEL[status]}
  </span>
)

const TaskCard: React.FC<{
  task: RoadmapTask
  canManage: boolean
  onToggle: () => void
  onToggleSub: (id: string, isDone: boolean) => void
  onAddSub: () => void
  onRemove: () => void
  onRemoveSub: (id: string) => void
  onOpenQuestionnaire?: () => void
}> = ({ task, canManage, onToggle, onToggleSub, onAddSub, onRemove, onRemoveSub, onOpenQuestionnaire }) => {
  const isDone = task.status === 'done'
  return (
    <div className="rounded-[14px] border border-w-line bg-w-panel2">
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border transition',
            isDone ? 'border-w-good bg-w-good text-black' : 'border-w-line text-transparent hover:border-w-accentDim'
          )}
          aria-label={isDone ? 'Снять отметку' : 'Отметить готовым'}
        >
          <Check className="h-3 w-3" strokeWidth={3.2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-bold', isDone ? 'text-w-muted line-through' : 'text-w-ink')}>
            {task.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-w-muted">
            {task.due_date && <span className="tabular-nums">до {formatDate(task.due_date)}</span>}
            {task.audience === 'coordinator' && <span className="text-w-muted2">координатор</span>}
            {task.needs_document && (
              <span className="inline-flex items-center gap-1 text-w-muted2"><FileUp className="h-3 w-3" /> документ</span>
            )}
            {task.needs_zoom && (
              <span className="inline-flex items-center gap-1 text-w-muted2"><Video className="h-3 w-3" /> zoom</span>
            )}
            {canManage ? (
              <button
                type="button"
                onClick={onOpenQuestionnaire}
                className="inline-flex items-center gap-1 rounded-full border border-w-accentDim/50 px-2 py-0.5 font-bold text-w-accentText transition hover:bg-w-accent/10"
              >
                <ClipboardList className="h-3 w-3" /> Анкета
              </button>
            ) : task.questionnaire_url ? (
              <a
                href={task.questionnaire_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-w-accentDim/50 px-2 py-0.5 font-bold text-w-accentText transition hover:bg-w-accent/10"
              >
                <ClipboardList className="h-3 w-3" /> Анкета
              </a>
            ) : null}
          </div>
        </div>
        <PriorityPill priority={task.priority} />
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

      {(task.subtasks.length > 0 || canManage) && (
        <div className="space-y-1.5 border-t border-w-line px-3 py-2 pl-[42px]">
          {task.subtasks.map((st) => (
            <div key={st.id} className="group flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleSub(st.id, st.is_done)}
                className={cn(
                  'grid h-[15px] w-[15px] shrink-0 place-items-center rounded border transition',
                  st.is_done ? 'border-w-good bg-w-good text-black' : 'border-w-line text-transparent hover:border-w-accentDim'
                )}
                aria-label={st.is_done ? 'Снять отметку' : 'Отметить'}
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3.4} />
              </button>
              <span className={cn('text-[12.5px]', st.is_done ? 'text-w-muted2 line-through' : 'text-w-ink/85')}>
                {st.title}
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => onRemoveSub(st.id)}
                  className="ml-auto text-w-muted2 opacity-0 transition hover:text-w-danger group-hover:opacity-100"
                  aria-label="Удалить подзадачу"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <button
              type="button"
              onClick={onAddSub}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-w-muted2 transition hover:text-w-accentText"
            >
              <Plus className="h-3 w-3" /> подзадача
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const PriorityPill: React.FC<{ priority: string }> = ({ priority }) => (
  <span
    className={cn(
      'shrink-0 rounded px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide',
      priority === 'required' && 'bg-w-accent text-black',
      priority === 'recommended' && 'border border-w-accentDim/60 text-w-accentText',
      priority === 'optional' && 'border border-w-line text-w-muted2'
    )}
  >
    {PRIORITY_LABEL[priority] || priority}
  </span>
)
