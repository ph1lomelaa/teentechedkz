import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { roadmapApi, type RoadmapSubtask, type RoadmapTask } from '@/api/roadmap'
import { DeadlineField } from '@/components/shared/DeadlineField'
import { getErrorMessage } from '@/lib/errorMessage'
import { overdueDaysOf, sortSubtasksByDeadline } from '@/lib/roadmapDeadline'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { ActionCell, type RowActions } from './TaskQueue'
import { STATUS_LABEL, formatDue, relativeDue, type WorkItem } from './workItems'

const SECTION = 'border-t border-w-line px-5 py-4'
const LABEL = 'mb-2 text-xs font-bold text-w-muted'

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-2xs text-w-muted2">{label}</dt>
    <dd className="mt-0.5 text-sm text-w-ink">{children}</dd>
  </div>
)

/** Подзадачи шага roadmap: отметка, срок у каждой и добавление новой. Данные берёт из roadmap студента. */
const Subtasks: React.FC<{
  task: RoadmapTask
  onChanged: () => void
}> = ({ task, onChanged }) => {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const taskDone = task.status === 'done'

  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: onChanged,
    onError: (error) => toast({ title: 'Не удалось сохранить', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const add = () => {
    const text = title.trim()
    if (!text) return
    run.mutate(() => roadmapApi.createSubtask(task.id, text, due || null), {
      onSuccess: () => {
        setTitle('')
        setDue('')
      },
    })
  }

  const rows = sortSubtasksByDeadline(task.subtasks)
  return (
    <div>
      {rows.length === 0 && <p className="mb-3 text-xs text-w-muted2">Подзадач пока нет.</p>}
      <ul className="space-y-1">
        {rows.map((sub: RoadmapSubtask) => (
          <li key={sub.id} className="group rounded-ctl px-2 py-2 hover:bg-w-panel2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={sub.is_done}
                onChange={() => run.mutate(() => roadmapApi.updateSubtask(sub.id, { is_done: !sub.is_done }))}
                aria-label={`Выполнено: ${sub.title}`}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className={cn('min-w-0 flex-1 text-sm leading-snug', sub.is_done ? 'text-w-muted line-through' : 'text-w-ink')}>{sub.title}</span>
              <button
                type="button"
                onClick={() => run.mutate(() => roadmapApi.deleteSubtask(sub.id))}
                aria-label={`Удалить подзадачу: ${sub.title}`}
                className="shrink-0 text-w-muted2 opacity-0 transition hover:text-w-danger group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <DeadlineField
              tone="w"
              label={`Срок подзадачи: ${sub.title}`}
              className="mt-1.5 justify-start pl-7"
              dueDate={sub.due_date}
              overdueDays={overdueDaysOf(sub, sub.is_done || taskDone)}
              taskDueDate={task.due_date}
              onChange={(next) => run.mutate(() => roadmapApi.updateSubtask(sub.id, { due_date: next }))}
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
          placeholder="Новая подзадача"
          aria-label="Новая подзадача"
          className="h-9 min-w-[10rem] flex-1 rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
        />
        <input
          type="date"
          value={due}
          onChange={(event) => setDue(event.target.value)}
          aria-label="Срок новой подзадачи"
          className="h-9 rounded-ctl border border-w-line bg-w-panel2 px-2 text-sm text-w-ink outline-none focus:border-w-accentDim"
        />
        <button
          type="button"
          onClick={add}
          disabled={!title.trim() || run.isPending}
          className="h-9 rounded-ctl bg-w-accent px-4 text-xs font-bold text-black transition hover:brightness-95 disabled:opacity-50"
        >
          Добавить
        </button>
      </div>
    </div>
  )
}

/**
 * Боковая панель задачи. Для шага roadmap — срок, подзадачи со сроками и действия;
 * для поручения — подробности и те же действия, что в строке.
 *
 * Подзадачи и описание берутся из roadmap студента, а не из списка очереди: список
 * отдаёт только счётчики подзадач, и показывать срок каждой он не умеет.
 */
export const TaskDetailPanel: React.FC<{
  item: WorkItem
  actions: RowActions
  onClose: () => void
  /** Что-то изменилось: страница перечитывает списки. */
  onChanged: () => void
}> = ({ item, actions, onClose, onChanged }) => {
  const queryClient = useQueryClient()
  const isRoadmap = item.kind === 'roadmap'

  const { data: roadmaps, isLoading } = useQuery({
    queryKey: ['student-roadmaps', item.studentId],
    queryFn: () => roadmapApi.studentRoadmaps(item.studentId!),
    enabled: isRoadmap && Boolean(item.studentId),
  })
  const task = useMemo(
    () => roadmaps?.flatMap((rm) => rm.stages.flatMap((stage) => stage.tasks)).find((t) => t.id === item.id),
    [roadmaps, item.id],
  )

  const changed = () => {
    queryClient.invalidateQueries({ queryKey: ['student-roadmaps', item.studentId] })
    onChanged()
  }

  const setDue = useMutation({
    mutationFn: (dueDate: string | null) => roadmapApi.updateTask(item.id, { due_date: dueDate }),
    onSuccess: changed,
    onError: (error) => toast({ title: 'Не удалось изменить срок', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const delegated = item.delegated
  // Внутри панели открывать её ещё раз незачем.
  const panelActions: RowActions = { ...actions, onOpen: () => undefined }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[color:var(--dialog-overlay)] backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-w-line bg-w-panel text-w-ink shadow-xl outline-none"
        >
          <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-black leading-snug">{item.title}</DialogPrimitive.Title>
              <p className="mt-1 text-xs text-w-muted">
                {item.kind === 'roadmap' ? `Roadmap · ${item.context}` : item.context}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label="Закрыть панель"
              className="shrink-0 rounded-ctl border border-w-line p-1.5 text-w-muted transition hover:text-w-ink"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-4">
            <Fact label="Студент">
              {item.studentId ? (
                <Link to={`/workspace/students/${item.studentId}${isRoadmap ? '#roadmap' : ''}`} className="font-bold hover:text-w-accentText">
                  {item.studentName || 'Студент'}
                </Link>
              ) : (
                <span className="text-w-muted2">Общая задача</span>
              )}
            </Fact>
            <Fact label="Статус">{STATUS_LABEL[item.status]}</Fact>
            {!isRoadmap && (
              <Fact label="Срок">
                {item.due ? (
                  <span className={cn(item.overdueDays > 0 && 'font-bold text-w-danger')}>
                    {formatDue(item.due)} · {relativeDue(item)}
                  </span>
                ) : (
                  <span className="text-w-muted2">Без срока</span>
                )}
              </Fact>
            )}
          </dl>

          {isRoadmap && (
            <div className={SECTION}>
              <p className={LABEL}>Срок задачи</p>
              <DeadlineField
                tone="w"
                label="Срок задачи"
                className="justify-start text-xs"
                dueDate={item.due}
                overdueDays={item.overdueDays}
                onChange={(next) => setDue.mutate(next)}
              />
            </div>
          )}

          {isRoadmap && (
            <>
              {isLoading && <p className={cn(SECTION, 'text-xs text-w-muted')}>Загружаем подробности…</p>}
              {task && (task.description || task.expected_result) && (
                <div className={SECTION}>
                  {task.description && (
                    <>
                      <p className={LABEL}>Описание</p>
                      <p className="whitespace-pre-line text-sm text-w-ink">{task.description}</p>
                    </>
                  )}
                  {task.expected_result && (
                    <>
                      <p className={cn(LABEL, task.description && 'mt-4')}>Ожидаемый результат</p>
                      <p className="text-sm text-w-ink">{task.expected_result}</p>
                    </>
                  )}
                </div>
              )}
              {task && (
                <div className={SECTION}>
                  <p className={LABEL}>Подзадачи</p>
                  <Subtasks task={task} onChanged={changed} />
                </div>
              )}
              {task?.review_comment && (
                <div className={SECTION}>
                  <p className={LABEL}>Комментарий проверки</p>
                  <p className="text-sm text-w-ink">{task.review_comment}</p>
                </div>
              )}
            </>
          )}

          {delegated && (
            <div className={SECTION}>
              <dl className="space-y-3">
                {delegated.expected_result && <Fact label="Ожидаемый результат">{delegated.expected_result}</Fact>}
                {delegated.acceptance_criteria && <Fact label="Критерии приёмки">{delegated.acceptance_criteria}</Fact>}
                {delegated.required_documents && delegated.required_documents.length > 0 && (
                  <Fact label="Нужные документы">{delegated.required_documents.join(', ')}</Fact>
                )}
                {delegated.result_text && <Fact label="Результат исполнителя">{delegated.result_text}</Fact>}
                {delegated.review_note && <Fact label="Комментарий проверки">{delegated.review_note}</Fact>}
                {!delegated.expected_result && !delegated.acceptance_criteria && !delegated.result_text && !delegated.review_note && (
                  <p className="text-xs text-w-muted2">Дополнительных подробностей нет.</p>
                )}
              </dl>
            </div>
          )}

          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-w-line bg-w-panel px-5 py-4">
            <ActionCell item={item} actions={panelActions} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
