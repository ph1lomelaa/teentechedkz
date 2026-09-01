import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Paperclip, X } from 'lucide-react'
import { tasksApi } from '@/api'
import type { StudentTask } from '@/types'
import { AppButton, EmptyState, PageHeader, Pill } from '@/components/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Label } from '@/components/ui/primitives/label'
import { Textarea } from '@/components/ui/primitives/textarea'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'
import { slaLabel } from './MentorTasksBoard'
import { QueryState } from '@/components/shared/QueryState'

// Намеренно не SLA_TRACKED_STATUSES с бэка: там вопрос «капают ли часы», здесь —
// «что исполнителю сейчас показывать». Отсюда два расхождения, оба осознанные:
// awaiting_signature входит, хотя SLA на паузе (ниже рисуется как blocked —
// человек должен видеть, почему не может взяться), а submitted не входит —
// сдано, ход не за ним. Общее с бэком одно: overdue входит обязательно, иначе
// уведомление о санкции вело бы на экран без этой задачи.
const ACTIVE_STATUSES = new Set([
  'open',
  'in_progress',
  'needs_revision',
  'overdue',
  'awaiting_signature',
])

interface Props {
  colorPrefix?: AdminColorPrefix
  studentHrefBase?: string
}

/** Задачи, назначенные текущему сотруднику. Горящие — первыми. */
export const MyTasksList: React.FC<Props> = ({
  colorPrefix = 'w',
  studentHrefBase = '/workspace/students',
}) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const [submitTask, setSubmitTask] = useState<StudentTask | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn: () => tasksApi.listAll({ scope: 'mine', size: 200 }),
  })

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StudentTask['status'] }) =>
      tasksApi.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast({ title: 'Статус обновлён' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось обновить'), variant: 'destructive' }),
  })

  // Горящие вперёд: то, что просрочено, должно быть первым на экране.
  const items = [...(data?.items ?? [])]
    .filter((task) => ACTIVE_STATUSES.has(task.status))
    .sort((a, b) => {
      if (a.sla_overdue !== b.sla_overdue) return a.sla_overdue ? -1 : 1
      const at = a.sla_due_at ? new Date(a.sla_due_at).getTime() : Infinity
      const bt = b.sla_due_at ? new Date(b.sla_due_at).getTime() : Infinity
      return at - bt
    })

  return (
    <div className="animate-fade-in">
      <PageHeader
        colorPrefix={colorPrefix}
        eyebrow="Кабинет"
        title="Мои задачи"
        description="Задачи от МЗК: сначала те, у которых горит срок."
      />

      {/* «Активных задач нет» на упавшем запросе читалось как «свободен»: сюда
          же ведёт уведомление о санкции SLA, и цена ошибки — пропущенная
          просрочка, за которую уже начислен штраф. */}
      <QueryState
        colorPrefix={colorPrefix}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={items.length === 0}
        empty={<EmptyState colorPrefix={colorPrefix} icon={<CheckCircle2 className="h-5 w-5" />} title="Активных задач нет" />}
      >
        <div className="space-y-2">
          {items.map((task) => {
            const sla = slaLabel(task)
            const blocked = task.status === 'awaiting_signature'
            return (
              <article
                key={task.id}
                className={cn('p-4', t.card, task.sla_overdue && 'border-current', task.sla_overdue && t.danger)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={cn('font-bold', t.ink)}>{task.task_text}</div>
                    <div className={cn('mt-1 flex flex-wrap items-center gap-2 text-xs', t.muted)}>
                      {task.student_id ? (
                        <Link to={`${studentHrefBase}/${task.student_id}`} className="hover:underline">
                          {task.student_name ?? 'студент'}
                        </Link>
                      ) : (
                        <Pill colorPrefix={colorPrefix} tone="neutral">общая задача</Pill>
                      )}
                      {sla && (
                        <span
                          className={cn(
                            'font-bold',
                            sla.tone === 'bad' && t.danger,
                            sla.tone === 'warn' && t.accentText,
                          )}
                        >
                          {sla.text}
                        </span>
                      )}
                      {task.sla_penalty_color && (
                        <span className={cn('inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-bold', t.dangerSoftBg, t.danger)}>
                          <AlertTriangle className="h-3 w-3" />санкция
                        </span>
                      )}
                    </div>
                    {blocked && (
                      <p className={cn('mt-2 text-xs', t.accentText)}>
                        Подпишите регламент — до этого задачу нельзя взять в работу.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!blocked && task.status !== 'in_progress' && (
                      <AppButton
                        colorPrefix={colorPrefix}
                        variant="subtle"
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ id: task.id, status: 'in_progress' })}
                      >
                        В работу
                      </AppButton>
                    )}
                    {!blocked && (
                      <AppButton
                        colorPrefix={colorPrefix}
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() => setSubmitTask(task)}
                      >
                        Сдать
                      </AppButton>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </QueryState>

      {submitTask && (
        <SubmitTaskDialog
          colorPrefix={colorPrefix}
          task={submitTask}
          onClose={() => setSubmitTask(null)}
          onSubmitted={() => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setSubmitTask(null)
          }}
        />
      )}
    </div>
  )
}

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Сдача задачи: текст результата и файлы-подтверждения.
 *
 * Файлы грузятся до смены статуса — приёмка может требовать обязательные
 * документы, и без них бэкенд не пустит задачу в submitted.
 */
const SubmitTaskDialog: React.FC<{
  colorPrefix: AdminColorPrefix
  task: StudentTask
  onClose: () => void
  onSubmitted: () => void
}> = ({ colorPrefix, task, onClose, onSubmitted }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [resultText, setResultText] = useState(task.result_text ?? '')
  const [files, setFiles] = useState<File[]>([])

  const { data: evidence } = useQuery({
    queryKey: ['tasks', task.id, 'evidence'],
    queryFn: () => tasksApi.listEvidence(task.id),
  })

  const mutation = useMutation({
    mutationFn: async () => {
      for (const file of files) {
        await tasksApi.uploadEvidence(task.id, file)
      }
      // Текст результата и статус — одним PATCH: иначе при падении второго
      // запроса задача осталась бы сданной без описания результата.
      return tasksApi.update(task.id, {
        result_text: resultText.trim() || null,
        status: 'submitted',
      } as Partial<StudentTask>)
    },
    onSuccess: () => {
      toast({ title: 'Задача сдана на проверку' })
      onSubmitted()
    },
    onError: (e) => {
      const detail = (e as { response?: { data?: { detail?: { message?: string; missing?: string[] } | string } } })
        ?.response?.data?.detail
      const missing = typeof detail === 'object' ? detail?.missing : undefined
      toast({
        title: missing?.length
          ? `Не хватает документов: ${missing.join(', ')}`
          : getErrorMessage(e, 'Не удалось сдать задачу'),
        variant: 'destructive',
      })
    },
  })

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const picked = [...list]
    const bad = picked.find((f) => !ACCEPTED_MIME.includes(f.type))
    if (bad) {
      toast({ title: `Недопустимый тип файла: ${bad.name}`, variant: 'destructive' })
      return
    }
    setFiles((cur) => [...cur, ...picked])
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Сдать задачу</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className={cn('text-sm font-bold', t.ink)}>{task.task_text}</p>
          {task.expected_result && (
            <p className={cn('text-xs', t.muted)}>
              <span className="font-bold">Ожидаемый результат:</span> {task.expected_result}
            </p>
          )}

          <div>
            <Label className={t.muted}>Что сделано</Label>
            <Textarea
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              placeholder="Опишите результат — это увидит проверяющий"
              className={cn('mt-1 min-h-[110px] border', t.borderLine, t.panel2, t.ink)}
              autoFocus
            />
          </div>

          <div>
            <Label className={t.muted}>Подтверждения (PDF, JPG, PNG, WEBP)</Label>
            <input
              type="file"
              multiple
              accept={ACCEPTED_MIME.join(',')}
              onChange={(e) => addFiles(e.target.files)}
              className={cn('mt-1 w-full text-sm', t.ink)}
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className={cn('flex items-center gap-2 text-xs', t.muted)}>
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
                      className={cn('shrink-0', t.dangerHover)}
                      aria-label={`Убрать ${f.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(evidence?.length ?? 0) > 0 && (
              <p className={cn('mt-2 text-xs', t.muted)}>
                Уже загружено: {evidence!.map((e) => e.file_name).join(', ')}
              </p>
            )}
          </div>

          {(task.required_documents?.length ?? 0) > 0 && (
            <p className={cn('text-xs', t.muted)}>
              Обязательные документы: {task.required_documents!.join(', ')}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={onClose}>Отмена</AppButton>
          <AppButton
            colorPrefix={colorPrefix}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Отправляем...' : 'Сдать на проверку'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
