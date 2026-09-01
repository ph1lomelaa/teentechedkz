import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { workspaceApi, WorkspaceRoadmapTask } from '@/api/workspace'
import { roadmapApi } from '@/api/roadmap'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { withViewTransition } from '@/lib/motion'
import { useWsEvent } from '@/lib/ws'
import { toast } from '@/hooks/use-toast'
import { cn, formatDate } from '@/lib/utils'
import { AppButton, AppCard, EmptyState, PageHeader, Pill, PriorityPill } from '@/components/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryError } from '@/components/shared/QueryState'

// Очередь ревью заявок студентов — клон анатомии StatusInboxPage (очередь с
// действиями + разобранный хвост), но отдельной страницей: StatusInboxPage
// смонтирован и в CRM, лезть в него нельзя.

const DAY_MS = 24 * 60 * 60 * 1000

// «отмечена 2 ч назад» — маленький относительный формат времени для очереди
function relativeTimeRu(iso: string | null): string {
  if (!iso) return '—'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
}

const httpStatus = (err: unknown) => (err as { response?: { status?: number } })?.response?.status

const isOverdue = (dueDate: string | null) =>
  Boolean(dueDate && new Date(dueDate) < new Date(new Date().toDateString()))

export const WorkspaceReviewPage: React.FC = () => {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { params, isPreview, mentorId } = useWorkspaceScope()
  const [returnTarget, setReturnTarget] = useState<WorkspaceRoadmapTask | null>(null)
  const [comment, setComment] = useState('')

  const { data: queueData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'review-queue', params],
    queryFn: () => workspaceApi.roadmapTasks({ review_status: 'pending', ...params }),
  })
  const { data: resolvedData } = useQuery({
    queryKey: ['workspace', 'review-resolved', params],
    queryFn: () => workspaceApi.roadmapTasks({ review_status: 'approved,returned', ...params }),
  })

  useWsEvent('task.review_requested', () => {
    qc.invalidateQueries({ queryKey: ['workspace', 'review-queue'] })
    qc.invalidateQueries({ queryKey: ['workspace', 'review-count'] })
  })
  useWsEvent('roadmap.updated', () => {
    qc.invalidateQueries({ queryKey: ['workspace', 'review-queue'] })
    qc.invalidateQueries({ queryKey: ['workspace', 'review-resolved'] })
  })

  const invalidateReview = () => {
    qc.invalidateQueries({ queryKey: ['workspace', 'review-queue'] })
    qc.invalidateQueries({ queryKey: ['workspace', 'review-resolved'] })
    qc.invalidateQueries({ queryKey: ['workspace', 'review-count'] })
    qc.invalidateQueries({ queryKey: ['workspace', 'roadmap'] })
    qc.invalidateQueries({ queryKey: ['workspace', 'dashboard'] })
  }

  const reviewMutation = useMutation({
    mutationFn: ({ taskId, action, comment: c }: { taskId: string; action: 'approve' | 'return'; comment?: string }) =>
      roadmapApi.reviewTask(taskId, c ? { action, comment: c } : { action }),
    onSuccess: (_roadmap, vars) => {
      if (vars.action === 'return') setReturnTarget(null)
      invalidateReview()
      toast({ title: vars.action === 'approve' ? 'Задача подтверждена' : 'Задача возвращена студенту' })
    },
    onError: (err, vars) => {
      if (vars.action === 'return') setReturnTarget(null)
      invalidateReview()
      toast({
        title: httpStatus(err) === 409 ? 'Задача уже разобрана' : 'Не удалось выполнить ревью',
        variant: 'destructive',
      })
    },
  })

  const queue = useMemo(
    () =>
      [...(queueData?.items ?? [])].sort(
        (a, b) =>
          (a.completed_at ? new Date(a.completed_at).getTime() : 0) -
          (b.completed_at ? new Date(b.completed_at).getTime() : 0),
      ),
    [queueData],
  )

  const resolvedRecent = useMemo(() => {
    const cutoff = Date.now() - 7 * DAY_MS
    return (resolvedData?.items ?? [])
      .filter((t) => t.reviewed_at && new Date(t.reviewed_at).getTime() >= cutoff)
      .sort((a, b) => new Date(b.reviewed_at!).getTime() - new Date(a.reviewed_at!).getTime())
  }, [resolvedData])

  const reviewedToday = useMemo(() => {
    const today = new Date().toDateString()
    return resolvedRecent.filter((t) => t.reviewed_at && new Date(t.reviewed_at).toDateString() === today).length
  }, [resolvedRecent])

  const openReturnDialog = (task: WorkspaceRoadmapTask) => {
    setComment('')
    setReturnTarget(task)
  }

  return (
    <div className="fade-in">
      <PageHeader
        colorPrefix="w"
        eyebrow={isPreview ? 'Preview кабинета ментора' : 'Кабинет ментора'}
        title="Проверка задач"
        description="Заявки студентов «задача сделана»: подтвердите выполнение или верните задачу с комментарием — студент увидит вердикт на своей карточке."
        action={
          <Pill colorPrefix="w" tone="neutral" className="bg-w-good/15 text-w-good">
            Проверено сегодня: {reviewedToday}
          </Pill>
        }
      />

      {/* Пустое состояние здесь живёт глубже, внутри секции («Всё проверено»),
          поэтому isEmpty не передаём: QueryState отвечает только за загрузку и
          ошибку, а «пусто» экран говорит сам и по-своему. */}
      {isError ? (
        <QueryError colorPrefix="w" error={error} onRetry={refetch} />
      ) : isLoading ? (
        <p className="text-sm text-w-muted">Загрузка…</p>
      ) : (
        <div key={mentorId ?? 'mine'} className="anim-view-in space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-w-ink">Ждут проверки ({queueData?.total ?? 0})</h2>
            {queue.length === 0 ? (
              <EmptyState
                colorPrefix="w"
                className="anim-view-in"
                icon={<ClipboardCheck className="h-6 w-6" />}
                title="Всё проверено"
                description="Новые заявки студентов появятся здесь."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {queue.map((task) => {
                  const stale = Boolean(
                    task.completed_at && Date.now() - new Date(task.completed_at).getTime() > DAY_MS,
                  )
                  return (
                    <AppCard
                      key={task.id}
                      colorPrefix="w"
                      className={cn('space-y-2.5 p-4', stale && 'border-w-accentDim')}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to={`/workspace/students/${task.student_id}#roadmap`}
                            className="text-xs font-bold text-w-accentText hover:underline"
                          >
                            {task.student_name}
                          </Link>
                          <div className="mt-0.5 text-sm font-bold text-w-ink">{task.title}</div>
                          <div className="mt-0.5 text-xs text-w-muted">
                            {task.stage_name} · отмечена {relativeTimeRu(task.completed_at)}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <PriorityPill priority={task.priority} colorPrefix="w" />
                          <span
                            className={cn(
                              'rounded-pill px-2.5 py-1 text-2xs font-bold',
                              isOverdue(task.due_date) ? 'bg-w-danger/15 text-w-danger' : 'bg-w-line text-w-muted',
                            )}
                          >
                            {task.due_date ? `до ${formatDate(task.due_date)}` : 'без дедлайна'}
                          </span>
                        </div>
                      </div>
                      {(task.subtasks_total > 0 || stale) && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-w-muted2">
                          {task.subtasks_total > 0 && (
                            <span>Подзадачи: {task.subtasks_done}/{task.subtasks_total}</span>
                          )}
                          {stale && <span className="text-2xs font-bold text-w-accentText">в очереди больше суток</span>}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <AppButton
                          colorPrefix="w"
                          size="sm"
                          className="active:scale-[0.98]"
                          disabled={reviewMutation.isPending}
                          onClick={() =>
                            withViewTransition(() => reviewMutation.mutate({ taskId: task.id, action: 'approve' }))
                          }
                        >
                          Подтвердить
                        </AppButton>
                        <AppButton
                          colorPrefix="w"
                          size="sm"
                          variant="ghost"
                          disabled={reviewMutation.isPending}
                          onClick={() => openReturnDialog(task)}
                        >
                          Вернуть
                        </AppButton>
                        <AppButton
                          colorPrefix="w"
                          size="sm"
                          variant="subtle"
                          onClick={() => navigate(`/workspace/students/${task.student_id}#roadmap`)}
                        >
                          Открыть
                        </AppButton>
                      </div>
                    </AppCard>
                  )
                })}
              </div>
            )}
          </section>

          {resolvedRecent.length > 0 && (
            <section className="anim-view-in space-y-3">
              <h2 className="text-sm font-bold text-w-ink">Разобранные за 7 дней ({resolvedRecent.length})</h2>
              <div className="space-y-2">
                {resolvedRecent.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-panel border border-w-line bg-w-panel2 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/workspace/students/${task.student_id}#roadmap`}
                        className="text-xs font-bold text-w-accentText hover:underline"
                      >
                        {task.student_name}
                      </Link>
                      <div className="mt-0.5 text-sm font-bold text-w-ink">{task.title}</div>
                      <div className="mt-0.5 text-xs text-w-muted">
                        {task.stage_name} · проверена {relativeTimeRu(task.reviewed_at)}
                      </div>
                      {task.review_comment && (
                        <div className="mt-1 text-xs text-w-muted">Комментарий: {task.review_comment}</div>
                      )}
                    </div>
                    <Pill
                      colorPrefix="w"
                      tone="neutral"
                      className={cn(
                        'shrink-0',
                        task.review_status === 'approved' ? 'bg-w-good/15 text-w-good' : 'bg-w-danger/15 text-w-danger',
                      )}
                    >
                      {task.review_status === 'approved' ? 'подтверждена' : 'возвращена'}
                    </Pill>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={Boolean(returnTarget)} onOpenChange={(open) => !open && setReturnTarget(null)}>
        <DialogContent className="portal border-w-line bg-w-panel text-w-ink">
          <DialogHeader>
            <DialogTitle className="font-display font-black text-w-ink">Вернуть задачу студенту</DialogTitle>
            <DialogDescription className="text-w-muted">
              {returnTarget?.student_name} · «{returnTarget?.title}». Комментарий обязателен — студент увидит его
              прямо на карточке задачи.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Что доработать и почему"
            className="min-h-[110px] border-w-line bg-w-panel2 text-w-ink placeholder:text-w-muted2 focus-visible:border-w-accentDim focus-visible:ring-w-accentDim"
          />
          <DialogFooter className="gap-2">
            <AppButton colorPrefix="w" variant="subtle" size="sm" onClick={() => setReturnTarget(null)}>
              Отмена
            </AppButton>
            <AppButton
              colorPrefix="w"
              size="sm"
              className="active:scale-[0.98]"
              disabled={!comment.trim() || reviewMutation.isPending}
              onClick={() =>
                returnTarget &&
                withViewTransition(() =>
                  reviewMutation.mutate({ taskId: returnTarget.id, action: 'return', comment: comment.trim() }),
                )
              }
            >
              Вернуть с комментарием
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
