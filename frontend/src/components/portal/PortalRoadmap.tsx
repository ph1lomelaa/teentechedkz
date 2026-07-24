import React, { useState } from 'react'
import { Check, FileText, Video, ClipboardList } from 'lucide-react'
import { Roadmap, RoadmapStage, RoadmapTask, ItemStatus } from '@/api/roadmap'
import { RoadmapHeaderCard } from '@/components/portal/RoadmapHeaderCard'
import { PortalQuestionnaireDialog } from '@/components/portal/PortalQuestionnaireDialog'
import { questionnairesApi } from '@/api/questionnaires'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { PriorityPill, StatusPill } from '@/components/ui'

const STATUS_LABEL: Record<ItemStatus, string> = {
  planned: 'Впереди',
  in_progress: 'В работе',
  done: 'Готово',
}

// Подписи под узлами таймлайна (как в оригинале: готово / сейчас / скоро)
const TIMELINE_SUB_LABEL: Record<ItemStatus, string> = {
  done: 'готово',
  in_progress: 'сейчас',
  planned: 'скоро',
}

// Строка срока — всегда видима, независимо от наличия description
function taskDue(t: RoadmapTask): string {
  if (t.status === 'done') return 'Выполнено'
  if (t.due_date) return `дедлайн ${formatDate(t.due_date)}`
  return 'Без срока'
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}


// Визуальный статус этапа для дорожки. Поле stage.status в БД меняется только
// ментором вручную, поэтому узлы выводятся из фактического выполнения задач —
// той же истины, по которой hero-карточка считает процент прогресса:
// все задачи готовы (или ментор отметил этап) → done; первый незавершённый
// этап — «текущий» (как во Vue, где первый этап создавался in_progress);
// частичный прогресс тоже показывается как «в работе».
function deriveStageStatuses(stages: RoadmapStage[]): ItemStatus[] {
  const isDone = (s: RoadmapStage) => {
    const total = s.tasks.length
    const done = s.tasks.filter((t) => t.status === 'done').length
    return s.status === 'done' || (total > 0 && done === total)
  }
  const currentIdx = stages.findIndex((s) => !isDone(s))
  return stages.map((s, i) => {
    if (isDone(s)) return 'done'
    const hasProgress =
      s.status === 'in_progress' ||
      s.tasks.some((t) => t.status === 'done' || t.status === 'in_progress')
    return hasProgress || i === currentIdx ? 'in_progress' : 'planned'
  })
}

export const PortalRoadmap: React.FC<{ roadmap: Roadmap }> = ({
  roadmap,
}) => {
  const [expandedTask, setExpandedTask] = useState<string | null>(null)

  const stageStatuses = React.useMemo(() => deriveStageStatuses(roadmap.stages), [roadmap])

  const currentIdx = Math.max(
    0,
    stageStatuses.findIndex((s) => s !== 'done')
  )
  const [selected, setSelected] = useState(currentIdx === -1 ? 0 : currentIdx)
  const stage = roadmap.stages[selected]

  const n = roadmap.stages.length
  const fillPct = n > 0 ? Math.min(100, Math.round((stageStatuses.reduce((acc, s) => acc + (s === 'done' ? 1 : s === 'in_progress' ? 0.5 : 0), 0) / n) * 100)) : 0

  return (
    <div>
      {/* ---- roadmap header card (donor .rm-card) ---- */}
      <RoadmapHeaderCard roadmap={roadmap} className="mb-5" />

      {/* horizontal flow */}
      <div className="relative py-2 mb-2">
        <div className="absolute left-[26px] right-[26px] top-[31px] h-[3px] bg-p-line rounded">
          <div className="absolute inset-y-0 left-0 bg-brand rounded" style={{ width: `${fillPct}%` }} />
        </div>
        <div className="flex justify-between gap-1.5 relative">
          {roadmap.stages.map((s, i) => (
            <button key={s.id} onClick={() => setSelected(i)} className="flex-1 text-center group">
              <StageNode index={i} status={stageStatuses[i]} selected={i === selected} />
              <div
                className={cn(
                  'text-xs font-bold mt-3 px-1',
                  stageStatuses[i] === 'planned' ? 'text-p-muted' : 'text-p-text'
                )}
              >
                {s.name}
              </div>
              <div className="text-2xs text-p-muted2 mt-0.5">
                {TIMELINE_SUB_LABEL[stageStatuses[i]]}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* stage detail */}
      {stage && (
        <StageDetail
          stage={stage}
          displayStatus={stageStatuses[selected]}
          expandedTask={expandedTask}
          onExpandTask={setExpandedTask}
        />
      )}

      {/* группы задач по этапам */}
      <div className="mt-6">
        {roadmap.stages.map((st) => (
          <div key={st.id} className="mb-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-5 w-1 rounded bg-brand" />
              <b className="font-display text-base font-extrabold text-p-text">{st.name}</b>
              <span className="rounded-full border border-p-line bg-p-panel px-2.5 py-0.5 text-xs text-p-muted2">
                {st.tasks.length} {plural(st.tasks.length, ['задача', 'задачи', 'задач'])}
              </span>
            </div>

            {st.tasks.length === 0 ? (
              <div className="rounded-panel border border-dashed border-p-line px-4 py-3.5 text-xs text-p-muted2">
                В этом этапе пока нет задач
              </div>
            ) : (
              <div className="space-y-2.5">
                {st.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3.5 rounded-panel border border-p-line bg-p-panel px-[18px] py-[15px] transition hover:translate-x-[3px] hover:border-p-accent-dim">
                    <div className={cn(
                      'grid h-[34px] w-[34px] flex-none place-items-center rounded-ctl transition',
                      t.status === 'done' ? 'bg-brand text-black' : 'bg-p-panel2 text-brand'
                    )}>
                      {t.status === 'done' ? <Check className="w-4 h-4" strokeWidth={3} /> : <FileText className="w-4 h-4" strokeWidth={1.8} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <b className={cn('block truncate text-sm font-bold', t.status === 'done' ? 'text-p-muted2 line-through' : 'text-p-text')}>
                        {t.title}
                      </b>
                      {t.description && (
                        <small className="block truncate text-xs text-p-muted">{t.description}</small>
                      )}
                      <small className="block truncate text-xs text-p-muted2">{taskDue(t)}</small>
                      {(t.description || t.expected_result || t.needs_document || t.needs_zoom || t.questionnaire_url) && (
                        <TaskMeta task={t} compact />
                      )}
                    </div>
                    <div className="flex flex-none items-center gap-1.5">
                      <PriorityPill priority={t.priority} colorPrefix="p" size="sm" />
                      <StatusPill status={t.status} colorPrefix="p" size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
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
  displayStatus?: ItemStatus
  expandedTask?: string | null
  onExpandTask?: (id: string | null) => void
}> = ({ stage, displayStatus, expandedTask, onExpandTask }) => {
  const filtered = stage.tasks

  return (
    <div className="mt-5 border border-p-line rounded-panel bg-p-panel overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-p-panel2 border-b border-p-line">
        <b className="font-display text-[15px] font-extrabold text-p-text">Этап: {stage.name}</b>
        <span className="text-xs font-bold text-brand">{STATUS_LABEL[displayStatus ?? stage.status]}</span>
      </div>
      <div className="px-5 py-2">
        {filtered.length === 0 && (
          <p className="text-xs text-p-muted2 py-4 text-center">Задач нет</p>
        )}
        {filtered.map((t, i) => (
          <div key={t.id} className={cn('py-3.5', i < filtered.length - 1 && 'border-b border-p-line')}>
            <div className="flex items-center gap-3.5">
              <div
                className={cn(
                  'w-[34px] h-[34px] rounded-ctl grid place-items-center shrink-0',
                  t.status === 'done' ? 'bg-brand text-black' : 'bg-p-panel2 text-brand'
                )}
                aria-hidden="true"
              >
                {t.status === 'done' ? <Check className="w-[17px] h-[17px]" strokeWidth={2.6} /> : <FileText className="w-[17px] h-[17px]" strokeWidth={1.8} />}
              </div>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => onExpandTask?.(expandedTask === t.id ? null : t.id)}
                  className="text-left hover:opacity-75 transition-opacity block w-full"
                >
                  <b className={cn('block truncate text-sm font-bold', t.status === 'done' ? 'text-p-muted2 line-through' : 'text-p-text')}>
                    {t.title}
                  </b>
                  {t.description && expandedTask !== t.id && (
                    <small className="block truncate text-xs text-p-muted">{t.description}</small>
                  )}
                  <small className="block truncate text-xs text-p-muted2">{taskDue(t)}</small>
                </button>
                {expandedTask === t.id && (t.description || t.expected_result || t.needs_document || t.needs_zoom || t.questionnaire_url) && (
                  <TaskMeta task={t} />
                )}
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <PriorityPill priority={t.priority} colorPrefix="p" size="sm" />
                <StatusPill status={t.status} colorPrefix="p" size="sm" />
              </div>
            </div>

            {expandedTask === t.id && t.subtasks.length > 0 && (
              <div className="pl-[36px] mt-2 grid gap-1.5">
                {t.subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'w-[18px] h-[18px] rounded border grid place-items-center shrink-0',
                        st.is_done ? 'bg-brand border-brand text-black' : 'border-p-muted2 text-transparent'
                      )}
                    >
                      <Check className="w-3 h-3" strokeWidth={3.4} />
                    </span>
                    <span className={cn('text-xs', st.is_done ? 'text-p-muted2 line-through' : 'text-p-muted')}>
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const TaskMeta: React.FC<{ task: RoadmapTask; compact?: boolean }> = ({ task, compact }) => (
  <div className={cn('mt-2 space-y-1.5', compact && 'mt-1.5')}>
    {task.description && !compact && (
      <p className="text-xs leading-relaxed text-p-muted">{task.description}</p>
    )}
    {task.expected_result && (
      <p className="text-xs leading-relaxed text-p-muted">
        <span className="font-bold text-p-text">Результат:</span> {task.expected_result}
      </p>
    )}
    {(task.needs_document || task.needs_zoom || task.questionnaire_url) && (
      <div className="flex flex-wrap gap-1.5">
        {task.needs_document && (
          <span className="inline-flex items-center gap-1 rounded-full border border-p-line bg-p-panel2 px-2 py-0.5 text-2xs font-bold text-p-muted">
            <FileText className="h-3 w-3" /> Document
          </span>
        )}
        {task.needs_zoom && (
          <span className="inline-flex items-center gap-1 rounded-full border border-p-line bg-p-panel2 px-2 py-0.5 text-2xs font-bold text-p-muted">
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
        className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-2xs font-bold text-brand transition hover:border-brand hover:bg-brand/15 disabled:opacity-60"
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
