import React, { useMemo, useState } from 'react'
import { Check, ChevronRight, Plus, X, Clock } from 'lucide-react'
import {
  roadmapApi,
  Roadmap,
  RoadmapStage,
  RoadmapTask,
  ItemStatus,
} from '@/api/roadmap'
import { cn } from '@/lib/utils'

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

export const RoadmapTimeline: React.FC<{
  roadmap: Roadmap
  canManage?: boolean
  onChanged: (updated: Roadmap) => void
}> = ({ roadmap, canManage = false, onChanged }) => {
  const { total, done, pct } = useMemo(() => taskCounts(roadmap), [roadmap])
  const [busy, setBusy] = useState(false)

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
  const addSubtask = (t: RoadmapTask) => {
    const title = window.prompt('Название подзадачи')?.trim()
    if (title) run(() => roadmapApi.createSubtask(t.id, title))
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
                <StatusPill status={s.status} />
                <span className="text-[11px] text-gray-400">
                  {s.tasks.filter((t) => t.status === 'done').length}/{s.tasks.length}
                </span>
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
                      onToggleSub={toggleSubtask}
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
                      onClick={() => addTask(s)}
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

const StatusPill: React.FC<{ status: ItemStatus }> = ({ status }) => (
  <span
    className={cn(
      'text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full',
      status === 'done' && 'bg-gray-100 text-gray-500',
      status === 'in_progress' && 'bg-brand text-brand-ink',
      status === 'planned' && 'border border-gray-200 text-gray-400'
    )}
  >
    {STAGE_STATUS_LABEL[status]}
  </span>
)

const TaskRow: React.FC<{
  task: RoadmapTask
  canManage: boolean
  onToggle: () => void
  onToggleSub: (id: string, isDone: boolean) => void
  onAddSub: () => void
  onRemove: () => void
  onRemoveSub: (id: string) => void
}> = ({ task, canManage, onToggle, onToggleSub, onAddSub, onRemove, onRemoveSub }) => {
  const isDone = task.status === 'done'
  return (
    <div className="border border-gray-200 rounded-[6px] bg-[#FBFAF7]">
      <div className="flex items-start gap-3 p-3">
        <button
          onClick={onToggle}
          className={cn(
            'w-[18px] h-[18px] rounded-[5px] grid place-items-center border shrink-0 mt-0.5',
            isDone ? 'bg-brand border-brand text-brand-ink' : 'bg-white border-gray-300 text-transparent'
          )}
          aria-label={isDone ? 'Снять отметку' : 'Отметить готовым'}
        >
          <Check className="w-3 h-3" strokeWidth={3.2} />
        </button>
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-sm font-medium',
              isDone ? 'line-through text-gray-400' : 'text-gray-900'
            )}
          >
            {task.title}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-gray-500 flex-wrap">
            {task.due_date && <span className="tabular-nums">до {task.due_date}</span>}
            {task.audience === 'coordinator' && <span className="text-gray-400">координатор</span>}
          </div>
        </div>
        <PriorityPill priority={task.priority} />
        {canManage && (
          <button onClick={onRemove} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Удалить задачу">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {(task.subtasks.length > 0 || canManage) && (
        <div className="border-t border-gray-100 px-3 py-2 pl-[42px] space-y-1.5">
          {task.subtasks.map((st) => (
            <div key={st.id} className="flex items-center gap-2 group">
              <button
                onClick={() => onToggleSub(st.id, st.is_done)}
                className={cn(
                  'w-[15px] h-[15px] rounded border grid place-items-center shrink-0',
                  st.is_done ? 'bg-brand border-brand text-brand-ink' : 'bg-white border-gray-300 text-transparent'
                )}
                aria-label={st.is_done ? 'Снять отметку' : 'Отметить'}
              >
                <Check className="w-2.5 h-2.5" strokeWidth={3.4} />
              </button>
              <span className={cn('text-[12.5px]', st.is_done ? 'line-through text-gray-400' : 'text-gray-700')}>
                {st.title}
              </span>
              {canManage && (
                <button
                  onClick={() => onRemoveSub(st.id)}
                  className="text-gray-300 hover:text-red-500 ml-auto opacity-0 group-hover:opacity-100"
                  aria-label="Удалить подзадачу"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <button
              onClick={onAddSub}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-black"
            >
              <Plus className="w-3 h-3" /> подзадача
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
      'text-[9px] font-bold uppercase tracking-wide px-1.5 py-1 rounded shrink-0',
      priority === 'required' && 'bg-sidebar text-white',
      priority === 'recommended' && 'border border-brand/60 text-[#9a7d00]',
      priority === 'optional' && 'border border-gray-200 text-gray-400'
    )}
  >
    {PRIORITY_LABEL[priority] || priority}
  </span>
)
