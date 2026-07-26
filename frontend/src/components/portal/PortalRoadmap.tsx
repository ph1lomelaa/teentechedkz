import React, { useState } from 'react'
import { useMutation, useQueryClient, QueryClient } from '@tanstack/react-query'
import { Check, FileText, Video, ClipboardList, MessageCircle } from 'lucide-react'
import {
  roadmapApi,
  Roadmap,
  RoadmapStage,
  RoadmapTask,
  RoadmapSubtask,
  FlatTask,
  ItemStatus,
  ReviewStatus,
  Audience,
} from '@/api/roadmap'
import { RoadmapHeaderCard } from '@/components/portal/RoadmapHeaderCard'
import { PortalQuestionnaireDialog } from '@/components/portal/PortalQuestionnaireDialog'
import { questionnairesApi } from '@/api/questionnaires'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useWsEvent } from '@/lib/ws'
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

// ---------------------------------------------------------------------------
// Двухосевая модель (см. STUDENT_MENTOR_FLOW_PLAN.md §2, §6):
// status='done' — истина ментора («две галочки»), review_status='pending' —
// заявка студента («одна галочка»). Дорожка и проценты считают заполнением
// «done ИЛИ pending», терминальная галочка узла — только по done.
// ---------------------------------------------------------------------------

/** Задача двигает прогресс дорожки/процентов: подтверждена или на проверке. */
const isFilled = (t: RoadmapTask | FlatTask): boolean =>
  t.status === 'done' || t.review_status === 'pending'

type ClaimTaskLike = { status: ItemStatus; review_status: ReviewStatus; audience: Audience }

/** Извлечь код ошибки бекенда (X-Error-Code / detail) для честного текста тоста. */
function claimErrorTitle(error: unknown): string {
  const resp = (error as {
    response?: { status?: number; headers?: Record<string, unknown>; data?: { detail?: unknown } }
  }).response
  const headerCode = resp?.headers?.['x-error-code']
  const detail = resp?.data?.detail
  const detailCode =
    detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string'
      ? (detail as { code: string }).code
      : ''
  const code =
    (typeof headerCode === 'string' && headerCode) ||
    (typeof detail === 'string' && detail) ||
    detailCode
  if (code.includes('ALREADY_DONE')) return 'Задача уже подтверждена ментором'
  if (code.includes('ROADMAP_ARCHIVED')) return 'Roadmap в архиве — отметки недоступны'
  if (code.includes('NOT_PENDING') || code.includes('ALREADY_REVIEWED')) return 'Задача уже разобрана'
  if (resp?.status === 409 || resp?.status === 422) return 'Задача уже разобрана'
  return 'Не удалось обновить задачу'
}

type ClaimSnapshot = { tasks?: FlatTask[]; roadmaps?: Roadmap[] }

/** Оптимистично флипнуть review_status задачи в обоих портальных кэшах. */
function patchTaskCaches(
  queryClient: QueryClient,
  taskId: string,
  patch: { review_status: ReviewStatus; completed_at: string | null }
): ClaimSnapshot {
  const snapshot: ClaimSnapshot = {
    tasks: queryClient.getQueryData<FlatTask[]>(['portal', 'tasks']),
    roadmaps: queryClient.getQueryData<Roadmap[]>(['portal', 'roadmap']),
  }
  if (snapshot.tasks) {
    queryClient.setQueryData<FlatTask[]>(
      ['portal', 'tasks'],
      snapshot.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
    )
  }
  if (snapshot.roadmaps) {
    queryClient.setQueryData<Roadmap[]>(
      ['portal', 'roadmap'],
      snapshot.roadmaps.map((r) => ({
        ...r,
        stages: r.stages.map((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
        })),
      }))
    )
  }
  return snapshot
}

/**
 * Заявка студента о выполнении (T1) и её снятие (T2) — одна реализация для
 * страниц «Задачи», «Главная» и «Мой roadmap»: оптимистичный патч обоих
 * кэшей, откат + инвалидация + нейтральный тост на 409/422.
 */
export function useTaskClaim() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['portal', 'tasks'] })
    queryClient.invalidateQueries({ queryKey: ['portal', 'roadmap'] })
  }

  const rollback = (error: unknown, _taskId: string, snapshot?: ClaimSnapshot) => {
    if (snapshot?.tasks) queryClient.setQueryData(['portal', 'tasks'], snapshot.tasks)
    if (snapshot?.roadmaps) queryClient.setQueryData(['portal', 'roadmap'], snapshot.roadmaps)
    invalidate()
    toast({ title: claimErrorTitle(error), variant: 'destructive' })
  }

  const cancelAndPatch = async (taskId: string, patch: { review_status: ReviewStatus; completed_at: string | null }) => {
    await queryClient.cancelQueries({ queryKey: ['portal', 'tasks'] })
    await queryClient.cancelQueries({ queryKey: ['portal', 'roadmap'] })
    return patchTaskCaches(queryClient, taskId, patch)
  }

  const claim = useMutation({
    mutationFn: (taskId: string) => roadmapApi.completeTask(taskId),
    onMutate: (taskId: string) =>
      cancelAndPatch(taskId, { review_status: 'pending', completed_at: new Date().toISOString() }),
    onError: rollback,
    onSuccess: invalidate,
  })

  const unclaim = useMutation({
    mutationFn: (taskId: string) => roadmapApi.uncompleteTask(taskId),
    onMutate: (taskId: string) => cancelAndPatch(taskId, { review_status: 'none', completed_at: null }),
    onError: rollback,
    onSuccess: invalidate,
  })

  return { claim, unclaim }
}

/**
 * Live-обновления вердиктов ментора: подтверждение (✓→✓✓ + тост), возврат
 * (тост-предупреждение), и общий cache-buster roadmap.updated. Обработчики
 * только инвалидируют ключи — обрыв WS не теряет данные (staleTime + поллинг).
 */
export function useReviewLiveUpdates() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['portal', 'tasks'] })
    queryClient.invalidateQueries({ queryKey: ['portal', 'roadmap'] })
  }

  useWsEvent('task.review_done', (data) => {
    invalidate()
    const d = (data ?? {}) as { action?: string; title?: string }
    if (d.action === 'approve') {
      toast({ title: `Ментор подтвердил: «${d.title ?? 'задача'}» ✓✓` })
    } else if (d.action === 'return') {
      toast({ title: 'Задача возвращена — посмотрите комментарий', variant: 'destructive' })
    }
  })
  useWsEvent('roadmap.updated', invalidate)
}

/**
 * Чекбокс «одна/две галочки» (язык мессенджеров, план §6):
 * — Открыта: пустой квадрат → клик = заявка;
 * — На проверке: одна жёлтая галочка в контурном квадрате, мягкий пульс → клик = снять;
 * — Подтверждено: двойная галочка на жёлтой заливке, НЕ кнопка;
 * — Возвращена: как открыта + акцентное кольцо.
 * Координаторские задачи — read-only плитка без афорданса.
 */
export const ClaimCheckbox: React.FC<{
  task: ClaimTaskLike
  onClaim: () => void
  onUnclaim: () => void
  size?: 'sm' | 'md'
  className?: string
}> = ({ task, onClaim, onUnclaim, size = 'sm', className }) => {
  const confirmed = task.status === 'done'
  const pending = !confirmed && task.review_status === 'pending'
  const returned = !confirmed && !pending && task.review_status === 'returned'

  // Вторая галочка анимируется только при живом переходе pending → done
  // (подтверждение ментора на глазах у студента), не при первом рендере.
  const prevState = React.useRef<'confirmed' | ReviewStatus>(confirmed ? 'confirmed' : task.review_status)
  const [liveConfirmed, setLiveConfirmed] = React.useState(false)
  React.useEffect(() => {
    const now = confirmed ? 'confirmed' : task.review_status
    if (prevState.current === 'pending' && now === 'confirmed') setLiveConfirmed(true)
    prevState.current = now
  }, [confirmed, task.review_status])

  const box = cn(
    'grid flex-none place-items-center rounded-ctl border-2',
    size === 'sm' ? 'h-[19px] w-[19px]' : 'h-[22px] w-[22px]',
    className
  )
  const checkSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  if (task.audience === 'coordinator') {
    return (
      <span
        className={cn(
          box,
          task.status === 'done'
            ? 'border-brand bg-brand text-black'
            : 'border-p-line bg-p-panel2 text-p-muted2'
        )}
        title={task.status === 'done' ? 'Выполнено координатором' : 'Задачу ведёт координатор'}
        aria-label={task.status === 'done' ? 'Выполнено координатором' : 'Задача координатора'}
      >
        {task.status === 'done' ? (
          <Check className={checkSize} strokeWidth={3.4} />
        ) : (
          <FileText className={checkSize} strokeWidth={1.8} />
        )}
      </span>
    )
  }

  if (confirmed) {
    return (
      <span
        className={cn(box, 'border-brand bg-brand text-black')}
        title="Изменить может только ментор"
        aria-label="Подтверждено ментором"
      >
        <span className={cn('relative block', checkSize)}>
          <Check className="absolute -left-[2px] top-0 h-full w-full" strokeWidth={3.4} />
          <Check
            className={cn('absolute left-[2.5px] top-0 h-full w-full', liveConfirmed && 'anim-double-check')}
            strokeWidth={3.4}
          />
        </span>
      </span>
    )
  }

  if (pending) {
    return (
      <button
        type="button"
        onClick={onUnclaim}
        className={cn(box, 'anim-pending-glow border-brand bg-transparent text-brand')}
        title="На проверке у ментора — нажмите, чтобы снять отметку"
        aria-label="Снять отметку о выполнении"
      >
        <Check className={cn(checkSize, 'anim-check-pop')} strokeWidth={3.4} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClaim}
      className={cn(
        box,
        'bg-transparent text-transparent transition hover:border-brand',
        returned ? 'border-brand/70 ring-[3px] ring-brand/25' : 'border-p-muted2/70'
      )}
      title={returned ? 'Возвращена ментором — можно отметить снова' : 'Отметить выполненной'}
      aria-label="Отметить задачу выполненной"
    >
      <Check className={checkSize} strokeWidth={3.4} />
    </button>
  )
}

/** Комментарий ментора на возвращённой задаче — фидбек первого класса. */
export const MentorComment: React.FC<{ comment: string; className?: string }> = ({ comment, className }) => (
  <div
    className={cn(
      'mt-2 flex items-start gap-2 rounded-panel border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-p-text',
      className
    )}
  >
    <MessageCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-brand" />
    <span className="min-w-0">
      <span className="font-bold">Комментарий ментора:</span> {comment}
    </span>
  </div>
)

/** Чип оси ревью: «На проверке ✓» / «Возвращена» — рядом с обычными пиллами. */
export const ReviewChip: React.FC<{ task: ClaimTaskLike; className?: string }> = ({ task, className }) => {
  if (task.status === 'done' || task.audience !== 'applicant') return null
  if (task.review_status === 'pending') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-brand/50 bg-brand/10 px-2.5 py-1 text-2xs font-bold text-brand',
          className
        )}
      >
        На проверке ✓
      </span>
    )
  }
  if (task.review_status === 'returned') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-p-danger/60 bg-transparent px-2.5 py-1 text-2xs font-bold text-p-danger',
          className
        )}
      >
        Возвращена
      </span>
    )
  }
  return null
}

// Визуальный статус этапа для дорожки. Поле stage.status в БД меняется только
// ментором вручную, поэтому узлы выводятся из фактического выполнения задач —
// той же истины, по которой hero-карточка считает процент прогресса.
// Заполнение двигают done И pending (заявка студента двигает дорожку в кадре
// клика), но терминальная галочка узла — только когда все задачи подтверждены
// (status='done'): этап «празднуется» только менторской истиной, полностью
// «заявленный» этап остаётся «сейчас».
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
      s.tasks.some((t) => isFilled(t) || t.status === 'in_progress')
    return hasProgress || i === currentIdx ? 'in_progress' : 'planned'
  })
}

export const PortalRoadmap: React.FC<{ roadmap: Roadmap }> = ({
  roadmap,
}) => {
  const queryClient = useQueryClient()
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const { claim, unclaim } = useTaskClaim()
  useReviewLiveUpdates()

  // Архивный roadmap полностью read-only: чекбоксы отсутствуют, а не «выключены»
  const readOnly = roadmap.status === 'archived'

  // Сабтаски — свободный микропрогресс студента: тоггл без ревью, оптимистично
  const subtaskToggle = useMutation({
    mutationFn: ({ subtaskId, is_done }: { subtaskId: string; is_done: boolean }) =>
      roadmapApi.updateSubtask(subtaskId, { is_done }),
    onMutate: async ({ subtaskId, is_done }) => {
      await queryClient.cancelQueries({ queryKey: ['portal', 'roadmap'] })
      const prevRoadmaps = queryClient.getQueryData<Roadmap[]>(['portal', 'roadmap'])
      if (prevRoadmaps) {
        queryClient.setQueryData<Roadmap[]>(
          ['portal', 'roadmap'],
          prevRoadmaps.map((r) => ({
            ...r,
            stages: r.stages.map((s) => ({
              ...s,
              tasks: s.tasks.map((t) => ({
                ...t,
                subtasks: t.subtasks.map((st) => (st.id === subtaskId ? { ...st, is_done } : st)),
              })),
            })),
          }))
        )
      }
      return { prevRoadmaps }
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prevRoadmaps) queryClient.setQueryData(['portal', 'roadmap'], ctx.prevRoadmaps)
      queryClient.invalidateQueries({ queryKey: ['portal', 'roadmap'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'tasks'] })
      toast({
        title: claimErrorTitle(error) === 'Не удалось обновить задачу' ? 'Не удалось обновить подзадачу' : claimErrorTitle(error),
        variant: 'destructive',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'roadmap'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'tasks'] })
    },
  })

  const stageStatuses = React.useMemo(() => deriveStageStatuses(roadmap.stages), [roadmap])

  const currentIdx = Math.max(
    0,
    stageStatuses.findIndex((s) => s !== 'done')
  )
  const [selected, setSelected] = useState(currentIdx === -1 ? 0 : currentIdx)
  const stage = roadmap.stages[selected]

  // Заливка линии непрерывна: линия тянется от центра первого узла к центру
  // последнего (n−1 сегментов), сегмент i заполняется пропорционально доле
  // «заполненных» задач этапа i (done или на проверке) — каждая заявка
  // двигает линию вперёд в кадре клика.
  const n = roadmap.stages.length
  const stageFraction = (s: RoadmapStage, i: number): number => {
    if (stageStatuses[i] === 'done') return 1
    if (s.tasks.length > 0) return s.tasks.filter(isFilled).length / s.tasks.length
    return stageStatuses[i] === 'in_progress' ? 0.5 : 0
  }
  const fillPct =
    n > 1
      ? Math.min(
          100,
          Math.round(
            (roadmap.stages.slice(0, n - 1).reduce((acc, s, i) => acc + stageFraction(s, i), 0) / (n - 1)) * 100
          )
        )
      : n === 1 && stageStatuses[0] === 'done'
        ? 100
        : 0

  const claimTask = (t: RoadmapTask) => claim.mutate(t.id)
  const unclaimTask = (t: RoadmapTask) => unclaim.mutate(t.id)
  const toggleSubtask = (st: RoadmapSubtask) =>
    subtaskToggle.mutate({ subtaskId: st.id, is_done: !st.is_done })

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
          readOnly={readOnly}
          onClaim={claimTask}
          onUnclaim={unclaimTask}
          onToggleSubtask={toggleSubtask}
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
                    {t.audience === 'applicant' && !readOnly ? (
                      <ClaimCheckbox
                        task={t}
                        size="md"
                        onClaim={() => claimTask(t)}
                        onUnclaim={() => unclaimTask(t)}
                      />
                    ) : (
                      <div className={cn(
                        'grid h-[34px] w-[34px] flex-none place-items-center rounded-ctl transition',
                        t.status === 'done' ? 'bg-brand text-black' : 'bg-p-panel2 text-brand'
                      )}>
                        {t.status === 'done' ? <Check className="w-4 h-4" strokeWidth={3} /> : <FileText className="w-4 h-4" strokeWidth={1.8} />}
                      </div>
                    )}
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
                      {t.status !== 'done' && t.review_status === 'returned' && t.review_comment && (
                        <MentorComment comment={t.review_comment} />
                      )}
                    </div>
                    <div className="flex flex-none items-center gap-1.5">
                      <ReviewChip task={t} />
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
  readOnly?: boolean
  onClaim: (t: RoadmapTask) => void
  onUnclaim: (t: RoadmapTask) => void
  onToggleSubtask: (st: RoadmapSubtask, t: RoadmapTask) => void
}> = ({ stage, displayStatus, expandedTask, onExpandTask, readOnly, onClaim, onUnclaim, onToggleSubtask }) => {
  const filtered = stage.tasks
  const doneCount = stage.tasks.filter((t) => t.status === 'done').length
  const pendingCount = stage.tasks.filter((t) => t.status !== 'done' && t.review_status === 'pending').length

  return (
    <div className="mt-5 border border-p-line rounded-panel bg-p-panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 bg-p-panel2 border-b border-p-line">
        <div className="min-w-0">
          <b className="font-display text-[15px] font-extrabold text-p-text">Этап: {stage.name}</b>
          <span className="mt-0.5 block text-xs text-p-muted">
            Выполнено {doneCount} · На проверке {pendingCount}
          </span>
        </div>
        <span className="flex-none text-xs font-bold text-brand">{STATUS_LABEL[displayStatus ?? stage.status]}</span>
      </div>
      <div className="px-5 py-2">
        {filtered.length === 0 && (
          <p className="text-xs text-p-muted2 py-4 text-center">Задач нет</p>
        )}
        {filtered.map((t, i) => {
          const claimable = !readOnly && t.audience === 'applicant'
          const allSubsDone = t.subtasks.length > 0 && t.subtasks.every((st) => st.is_done)
          return (
          <div key={t.id} className={cn('py-3.5', i < filtered.length - 1 && 'border-b border-p-line')}>
            <div className="flex items-center gap-3.5">
              {claimable ? (
                <ClaimCheckbox
                  task={t}
                  size="md"
                  onClaim={() => onClaim(t)}
                  onUnclaim={() => onUnclaim(t)}
                />
              ) : (
                <div
                  className={cn(
                    'w-[34px] h-[34px] rounded-ctl grid place-items-center shrink-0',
                    t.status === 'done' ? 'bg-brand text-black' : 'bg-p-panel2 text-brand'
                  )}
                  aria-hidden="true"
                >
                  {t.status === 'done' ? <Check className="w-[17px] h-[17px]" strokeWidth={2.6} /> : <FileText className="w-[17px] h-[17px]" strokeWidth={1.8} />}
                </div>
              )}
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
                {t.status !== 'done' && t.review_status === 'pending' && (
                  <small className="mt-0.5 block text-xs text-brand/90">
                    Ментор проверит и подтвердит — обычно в течение 1–2 дней
                  </small>
                )}
                {expandedTask === t.id && (t.description || t.expected_result || t.needs_document || t.needs_zoom || t.questionnaire_url) && (
                  <TaskMeta task={t} />
                )}
                {t.status !== 'done' && t.review_status === 'returned' && t.review_comment && (
                  <MentorComment comment={t.review_comment} />
                )}
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <ReviewChip task={t} />
                <PriorityPill priority={t.priority} colorPrefix="p" size="sm" />
                <StatusPill status={t.status} colorPrefix="p" size="sm" />
              </div>
            </div>

            {expandedTask === t.id && t.subtasks.length > 0 && (
              <div className="pl-[36px] mt-2 grid gap-1.5">
                {t.subtasks.map((st) =>
                  claimable ? (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onToggleSubtask(st, t)}
                      className="group/sub flex items-center gap-2.5 text-left"
                      aria-label={st.is_done ? `Снять отметку: ${st.title}` : `Отметить подзадачу: ${st.title}`}
                    >
                      <span
                        className={cn(
                          'w-[18px] h-[18px] rounded border grid place-items-center shrink-0 transition',
                          st.is_done
                            ? 'bg-brand border-brand text-black'
                            : 'border-p-muted2 text-transparent group-hover/sub:border-brand'
                        )}
                      >
                        <Check className={cn('w-3 h-3', st.is_done && 'anim-check-pop')} strokeWidth={3.4} />
                      </span>
                      <span className={cn('text-xs', st.is_done ? 'text-p-muted2 line-through' : 'text-p-muted')}>
                        {st.title}
                      </span>
                    </button>
                  ) : (
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
                  )
                )}
                {/* нажим: последняя сабтаска готова, а задача ещё не заявлена */}
                {claimable && allSubsDone && t.status !== 'done' && t.review_status !== 'pending' && (
                  <button
                    type="button"
                    onClick={() => onClaim(t)}
                    className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-ctl border border-brand/50 bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand transition hover:bg-brand hover:text-black"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    Все подзадачи готовы — отметить задачу выполненной?
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
