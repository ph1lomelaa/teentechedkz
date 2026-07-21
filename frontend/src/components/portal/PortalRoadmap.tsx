import React, { useMemo, useState } from 'react'
import { Check, MapPin, Clock, FileText, Video, ClipboardList } from 'lucide-react'
import { roadmapApi, Roadmap, RoadmapStage, RoadmapTask, ItemStatus } from '@/api/roadmap'
import { RoadmapHeaderCard } from '@/components/portal/RoadmapHeaderCard'
import { PortalQuestionnaireDialog } from '@/components/portal/PortalQuestionnaireDialog'
import { questionnairesApi } from '@/api/questionnaires'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const PRIORITY_LABEL: Record<string, string> = {
  required: 'Обязательно',
  recommended: 'Желательно',
  optional: 'По желанию',
}
const STATUS_LABEL: Record<ItemStatus, string> = {
  planned: 'Впереди',
  in_progress: 'В работе',
  done: 'Готово',
}

function counts(rm: Roadmap) {
  let total = 0
  let done = 0
  for (const s of rm.stages) for (const t of s.tasks) {
    total += 1
    if (t.status === 'done') done += 1
  }
  const stagesDone = rm.stages.filter((s) => s.status === 'done').length
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, stagesDone }
}

export const PortalRoadmap: React.FC<{ roadmap: Roadmap; onChanged: (r: Roadmap) => void }> = ({
  roadmap,
  onChanged,
}) => {
  const { stagesDone } = useMemo(() => counts(roadmap), [roadmap])
  const [view, setView] = useState<'timeline' | 'tasks'>('timeline')
  const [filter, setFilter] = useState<'all' | 'in_progress' | 'done'>('all')
  const [busy, setBusy] = useState(false)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)

  const currentIdx = Math.max(
    0,
    roadmap.stages.findIndex((s) => s.status !== 'done')
  )
  const [selected, setSelected] = useState(currentIdx === -1 ? 0 : currentIdx)
  const stage = roadmap.stages[selected]

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
  const toggleSub = (id: string, isDone: boolean) => run(() => roadmapApi.updateSubtask(id, { is_done: !isDone }))

  const n = roadmap.stages.length
  const fillPct = n > 1 ? (stagesDone / (n - 1)) * 100 : stagesDone ? 100 : 0

  return (
    <div>
      {/* ---- roadmap header card (donor .rm-card) ---- */}
      <RoadmapHeaderCard roadmap={roadmap} className="mb-5" />

      {/* ---- view toggle + filters ---- */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="inline-flex bg-p-panel border border-p-line rounded-[12px] p-1">
          {(['timeline', 'tasks'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-[18px] py-2 rounded-[9px] text-[12.5px] font-bold transition-colors',
                view === v ? 'bg-brand text-black' : 'text-p-muted hover:text-p-text'
              )}
            >
              {v === 'timeline' ? 'Таймлайн' : 'Задачи'}
            </button>
          ))}
        </div>

        {view === 'timeline' && (
          <div className="inline-flex bg-p-panel border border-p-line rounded-[12px] p-1">
            {(['all', 'in_progress', 'done'] as const).map((f) => {
              const labels: Record<typeof f, string> = {
                all: 'Все',
                in_progress: 'В работе',
                done: 'Готово',
              }
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-[16px] py-2 rounded-[9px] text-[12.5px] font-bold transition-colors whitespace-nowrap',
                    filter === f ? 'bg-brand text-black' : 'text-p-muted hover:text-p-text'
                  )}
                >
                  {labels[f]}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {view === 'timeline' ? (
        <>
          {/* horizontal flow */}
          <div className="relative py-2 mb-2">
            <div className="absolute left-[26px] right-[26px] top-[31px] h-[3px] bg-p-line rounded">
              <div className="absolute inset-y-0 left-0 bg-brand rounded" style={{ width: `${fillPct}%` }} />
            </div>
            <div className="flex justify-between gap-1.5 relative">
              {roadmap.stages.map((s, i) => (
                <button key={s.id} onClick={() => setSelected(i)} className="flex-1 text-center group">
                  <StageNode index={i} status={s.status} selected={i === selected} />
                  <div
                    className={cn(
                      'text-[11.5px] font-bold mt-3 px-1',
                      s.status === 'planned' ? 'text-p-muted' : 'text-p-text'
                    )}
                  >
                    {s.name}
                  </div>
                  <div className="text-[10px] text-p-muted2 mt-0.5">
                    {s.tasks.filter((t) => t.status === 'done').length}/{s.tasks.length} задач
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* stage detail with filter */}
          {stage && (
            <StageDetail
              stage={stage}
              onToggleTask={toggleTask}
              onToggleSub={toggleSub}
              filter={filter}
              expandedTask={expandedTask}
              onExpandTask={setExpandedTask}
            />
          )}
        </>
      ) : (
        <TasksBoard roadmap={roadmap} onToggleTask={toggleTask} />
      )}
    </div>
  )
}

const StageNode: React.FC<{ index: number; status: ItemStatus; selected: boolean }> = ({ index, status, selected }) => (
  <div
    className={cn(
      'w-[46px] h-[46px] rounded-full mx-auto grid place-items-center font-display font-black text-[15px] border-[3px] transition-all relative z-[2]',
      status === 'done' && 'bg-brand border-brand text-black',
      status === 'in_progress' && 'bg-black border-brand text-brand',
      status === 'planned' && 'bg-p-panel border-p-line text-p-muted',
      selected && 'shadow-[0_0_0_5px_rgba(255,212,0,0.16)]'
    )}
  >
    {status === 'done' ? <Check className="w-5 h-5" strokeWidth={3} /> : index + 1}
  </div>
)

const StageDetail: React.FC<{
  stage: RoadmapStage
  onToggleTask: (t: RoadmapTask) => void
  onToggleSub: (id: string, isDone: boolean) => void
  filter?: 'all' | 'in_progress' | 'done'
  expandedTask?: string | null
  onExpandTask?: (id: string | null) => void
}> = ({ stage, onToggleTask, onToggleSub, filter = 'all', expandedTask, onExpandTask }) => {
  const filtered = filter === 'all' ? stage.tasks : stage.tasks.filter((t) => t.status === filter)

  return (
    <div className="mt-5 border border-p-line rounded-[16px] bg-p-panel overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-p-panel2 border-b border-p-line">
        <b className="font-display text-[15px] font-extrabold text-p-text">{stage.name}</b>
        <span className="text-[11px] font-bold text-brand">{STATUS_LABEL[stage.status]}</span>
      </div>
      <div className="px-5 py-2">
        {filtered.length === 0 && (
          <p className="text-[13px] text-p-muted2 py-4 text-center">
            {filter === 'all' ? 'Задач нет' : `Задач статуса "${filter === 'in_progress' ? 'В работе' : 'Готово'}" нет`}
          </p>
        )}
        {filtered.map((t, i) => (
          <div key={t.id} className={cn('py-3.5', i < filtered.length - 1 && 'border-b border-p-line')}>
            <div className="flex items-center gap-3.5">
              <button
                onClick={() => onToggleTask(t)}
                className={cn(
                  'w-[22px] h-[22px] rounded-[6px] border-2 grid place-items-center shrink-0 transition-colors hover:border-brand',
                  t.status === 'done' ? 'bg-brand border-brand text-black' : 'border-p-muted2 text-transparent'
                )}
                aria-label={t.status === 'done' ? 'Снять отметку' : 'Отметить готовым'}
              >
                <Check className="w-3 h-3" strokeWidth={3.4} />
              </button>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => onExpandTask?.(expandedTask === t.id ? null : t.id)}
                  className="text-left hover:opacity-75 transition-opacity"
                >
                  <b className={cn('block text-[13.5px] font-bold', t.status === 'done' ? 'text-p-muted2 line-through' : 'text-p-text')}>
                    {t.title}
                  </b>
                </button>
                {t.due_date && (
                  <small className="text-[11.5px] text-p-muted flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-3 h-3" /> до {t.due_date}
                  </small>
                )}
                {expandedTask === t.id && (t.description || t.expected_result || t.needs_document || t.needs_zoom || t.questionnaire_url) && (
                  <TaskMeta task={t} />
                )}
              </div>
              <PriorityPill priority={t.priority} />
            </div>

            {expandedTask === t.id && t.subtasks.length > 0 && (
              <div className="pl-[36px] mt-2 grid gap-1.5">
                {t.subtasks.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => onToggleSub(st.id, st.is_done)}
                    className="flex items-center gap-2.5 text-left hover:opacity-75 transition-opacity"
                  >
                    <span
                      className={cn(
                        'w-[15px] h-[15px] rounded border grid place-items-center shrink-0 transition-colors hover:border-brand',
                        st.is_done ? 'bg-brand border-brand text-black' : 'border-p-muted2 text-transparent'
                      )}
                    >
                      <Check className="w-2.5 h-2.5" strokeWidth={3.4} />
                    </span>
                    <span className={cn('text-[12.5px]', st.is_done ? 'text-p-muted2 line-through' : 'text-p-muted')}>
                      {st.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const TasksBoard: React.FC<{ roadmap: Roadmap; onToggleTask: (t: RoadmapTask) => void }> = ({ roadmap, onToggleTask }) => {
  const all = roadmap.stages.flatMap((s) => s.tasks.map((t) => ({ ...t, stage_name: s.name })))
  const groups: { status: ItemStatus; title: string }[] = [
    { status: 'in_progress', title: 'В работе' },
    { status: 'planned', title: 'Запланировано' },
    { status: 'done', title: 'Готово' },
  ]
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const rows = all.filter((t) => t.status === g.status)
        if (rows.length === 0) return null
        return (
          <div key={g.status}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-1 h-5 rounded bg-brand" />
              <b className="font-display text-[16px] font-extrabold text-p-text">{g.title}</b>
              <span className="text-[11px] text-p-muted2 bg-p-panel border border-p-line px-2.5 py-0.5 rounded-full">{rows.length}</span>
            </div>
            <div className="space-y-2.5">
              {rows.map((t) => (
                <div key={t.id} className="flex items-center gap-3.5 px-4 py-3.5 bg-p-panel border border-p-line rounded-[13px]">
                  <button
                    onClick={() => onToggleTask(t)}
                    className={cn(
                      'w-[22px] h-[22px] rounded-[6px] border-2 grid place-items-center shrink-0',
                      t.status === 'done' ? 'bg-brand border-brand text-black' : 'border-p-muted2 text-transparent'
                    )}
                    aria-label="toggle"
                  >
                    <Check className="w-3 h-3" strokeWidth={3.4} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <b className={cn('block text-[13.5px] font-bold', t.status === 'done' ? 'text-p-muted2 line-through' : 'text-p-text')}>
                      {t.title}
                    </b>
                    <small className="text-[11px] text-p-muted flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" /> {t.stage_name}
                      {t.due_date && <span className="text-p-muted2">· до {t.due_date}</span>}
                    </small>
                    {(t.description || t.expected_result || t.needs_document || t.needs_zoom || t.questionnaire_url) && (
                      <TaskMeta task={t} compact />
                    )}
                  </div>
                  <PriorityPill priority={t.priority} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const PriorityPill: React.FC<{ priority: string }> = ({ priority }) => (
  <span
    className={cn(
      'text-[10.5px] font-bold px-2.5 py-1 rounded-full shrink-0',
      priority === 'required' && 'bg-brand/15 text-brand',
      priority === 'recommended' && 'bg-p-panel2 text-p-muted',
      priority === 'optional' && 'bg-p-panel2 text-p-muted2'
    )}
  >
    {PRIORITY_LABEL[priority] || priority}
  </span>
)

const TaskMeta: React.FC<{ task: RoadmapTask; compact?: boolean }> = ({ task, compact }) => (
  <div className={cn('mt-2 space-y-1.5', compact && 'mt-1.5')}>
    {task.description && !compact && (
      <p className="text-[12px] leading-relaxed text-p-muted">{task.description}</p>
    )}
    {task.expected_result && (
      <p className="text-[12px] leading-relaxed text-p-muted">
        <span className="font-bold text-p-text">Результат:</span> {task.expected_result}
      </p>
    )}
    {(task.needs_document || task.needs_zoom || task.questionnaire_url) && (
      <div className="flex flex-wrap gap-1.5">
        {task.needs_document && (
          <span className="inline-flex items-center gap-1 rounded-full border border-p-line bg-p-panel2 px-2 py-0.5 text-[10.5px] font-bold text-p-muted">
            <FileText className="h-3 w-3" /> Document
          </span>
        )}
        {task.needs_zoom && (
          <span className="inline-flex items-center gap-1 rounded-full border border-p-line bg-p-panel2 px-2 py-0.5 text-[10.5px] font-bold text-p-muted">
            <Video className="h-3 w-3" /> Zoom
          </span>
        )}
        {task.questionnaire_url && (
          <QuestionnaireButton task={task} />
        )}
      </div>
    )}
  </div>
)

const QuestionnaireButton: React.FC<{ task: RoadmapTask }> = ({ task }) => {
  const [loading, setLoading] = useState(false)
  const [questionnaireId, setQuestionnaireId] = useState<string | null>(null)

  const openQuestionnaire = async () => {
    if (loading) return
    setLoading(true)
    try {
      const questionnaire = await questionnairesApi.forTask(task.id)
      if (questionnaire) {
        setQuestionnaireId(questionnaire.id)
        return
      }

      if (task.questionnaire_url && /^https?:\/\//i.test(task.questionnaire_url)) {
        window.open(task.questionnaire_url, '_blank', 'noopener,noreferrer')
        return
      }

      toast({
        title: 'Анкета ещё не подготовлена',
        description: 'Попросите ментора отправить анкету повторно.',
        variant: 'destructive',
      })
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({
        title: 'Не удалось открыть анкету',
        description: typeof detail === 'string' ? detail : 'Обновите страницу и попробуйте ещё раз.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openQuestionnaire}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10.5px] font-bold text-brand transition hover:border-brand hover:bg-brand/15 disabled:opacity-60"
      >
        <ClipboardList className="h-3 w-3" /> {loading ? 'Открываем…' : 'Анкета'}
      </button>
      {questionnaireId && (
        <PortalQuestionnaireDialog
          questionnaireId={questionnaireId}
          open
          onClose={() => setQuestionnaireId(null)}
        />
      )}
    </>
  )
}
