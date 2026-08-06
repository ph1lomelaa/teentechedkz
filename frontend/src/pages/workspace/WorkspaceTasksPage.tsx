import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ClipboardList, FileUp, Route, Video } from 'lucide-react'
import { roadmapApi } from '@/api/roadmap'
import { workspaceApi, WorkspaceRoadmapTask } from '@/api/workspace'
import { tasksApi } from '@/api'
import { StudentTask } from '@/types'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { withViewTransition } from '@/lib/motion'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { WorkspaceQuestionnaireDialog } from '@/components/workspace/WorkspaceQuestionnaireDialog'
import { AppCard, AppSelect, EmptyState, PageHeader, SegmentedTabs, UrgencyBadge } from '@/components/ui'

const PRIORITY_LABEL: Record<string, string> = {
  required: 'Обязательно',
  recommended: 'Желательно',
  optional: 'По желанию',
}

const WORKFLOW_STATUS_LABEL: Record<StudentTask['status'], string> = {
  open: 'Открыта',
  awaiting_signature: 'Ожидает подписи',
  in_progress: 'В работе',
  submitted: 'На проверке',
  needs_revision: 'На доработке',
  accepted: 'Принята',
  blocked_by_agreement: 'Заблокирована',
  overdue: 'Просрочена',
  cancelled: 'Отменена',
  done: 'Закрыта',
}

export const WorkspaceTasksPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { params } = useWorkspaceScope()
  const [status, setStatus] = useLocalState<'open' | 'done'>('workspace:tasks:status', 'open')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:tasks:studentFilter', '')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [questionnaireTask, setQuestionnaireTask] = useState<WorkspaceRoadmapTask | null>(null)
  const [delegatedStatus, setDelegatedStatus] = useLocalState<StudentTask['status'] | ''>('workspace:tasks:delegatedStatus', '')
  const [delegatedPriority, setDelegatedPriority] = useLocalState<string>('workspace:tasks:delegatedPriority', '')
  const [evidenceTask, setEvidenceTask] = useState<StudentTask | null>(null)
  const [evidenceRequirement, setEvidenceRequirement] = useState('')
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [reviewTask, setReviewTask] = useState<StudentTask | null>(null)
  const [reviewDecision, setReviewDecision] = useState<'accepted' | 'needs_revision'>('accepted')
  const [reviewNote, setReviewNote] = useState('')

  // ---- roadmap tasks (student-facing) ----
  const { data: roadmapData, isLoading: roadmapLoading } = useQuery({
    queryKey: ['workspace', 'roadmap-tasks', status, params],
    queryFn: () => workspaceApi.roadmapTasks({ ...params, status }),
  })

  const { data: studentsData } = useQuery({
    queryKey: ['workspace', 'tasks', 'students', params],
    queryFn: () => workspaceApi.students(params),
  })

  const { data: delegatedData, isLoading: delegatedLoading } = useQuery({
    queryKey: ['workspace', 'delegated-tasks', params],
    queryFn: () => tasksApi.listAll({ ...params, size: 200 }),
  })
  const delegatedTasks = (delegatedData?.items ?? []).filter((task) => (
    (!delegatedStatus || task.status === delegatedStatus)
    && (!delegatedPriority || task.priority === delegatedPriority)
  ))
  const delegatedMutation = useMutation({
    mutationFn: ({ task, status, note }: { task: StudentTask; status: StudentTask['status']; note?: string }) => tasksApi.update(task.id, { status, ...(note !== undefined ? { review_note: note } : {}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace', 'delegated-tasks'] }),
    onError: () => toast({ title: 'Не удалось обновить статус задачи', variant: 'destructive' }),
  })
  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!reviewTask) throw new Error('Задача не выбрана')
      return tasksApi.update(reviewTask.id, { status: reviewDecision, review_note: reviewNote.trim() || undefined })
    },
    onSuccess: () => {
      setReviewTask(null)
      setReviewNote('')
      queryClient.invalidateQueries({ queryKey: ['workspace', 'delegated-tasks'] })
      toast({ title: reviewDecision === 'accepted' ? 'Результат принят' : 'Задача возвращена на доработку' })
    },
    onError: () => toast({ title: 'Не удалось сохранить решение', variant: 'destructive' }),
  })
  const evidenceMutation = useMutation({
    mutationFn: () => {
      if (!evidenceTask || !evidenceFile) throw new Error('Файл не выбран')
      return tasksApi.uploadEvidence(evidenceTask.id, evidenceFile, evidenceRequirement || undefined)
    },
    onSuccess: () => {
      setEvidenceTask(null)
      setEvidenceRequirement('')
      setEvidenceFile(null)
      toast({ title: 'Подтверждение загружено' })
    },
    onError: () => toast({ title: 'Не удалось загрузить подтверждение', variant: 'destructive' }),
  })
  const { data: evidenceData, isLoading: evidenceLoading } = useQuery({
    queryKey: ['workspace', 'task-evidence', evidenceTask?.id],
    queryFn: () => tasksApi.listEvidence(evidenceTask!.id),
    enabled: Boolean(evidenceTask),
  })

  const refreshRoadmap = () => {
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap-tasks'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'dashboard'] })
  }
  const toggleRoadmapMutation = useMutation({
    mutationFn: (task: WorkspaceRoadmapTask) =>
      roadmapApi.updateTask(task.id, { status: task.status === 'done' ? 'planned' : 'done' }),
    onSuccess: refreshRoadmap,
    onError: () => toast({ title: 'Не удалось обновить задачу', variant: 'destructive' }),
  })

  const roadmapTasks = roadmapData?.items ?? []
  const students = (studentsData?.items ?? []).map((item) => item.student)
  const filteredRoadmapTasks = roadmapTasks.filter((task) => !studentFilter || task.student_id === studentFilter)

  return (
    <div className="fade-in">
      <PageHeader colorPrefix="w"
        eyebrow="Кабинет ментора"
        title="Задачи"
        description="Roadmap-задачи ваших студентов в одном рабочем списке."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs colorPrefix="w"
          value={status}
          onChange={(value) => withViewTransition(() => setStatus(value as typeof status))}
          tabs={[
            { value: 'open', label: 'Открытые' },
            { value: 'done', label: 'Закрытые' },
          ]}
        />
        <AppSelect colorPrefix="w"
          value={studentFilter}
          onChange={(event) => {
            const next = event.target.value
            withViewTransition(() => setStudentFilter(next))
          }}
          className="bg-w-panel2 md:min-w-[240px]"
        >
          <option value="">Все студенты</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name}</option>
          ))}
        </AppSelect>
      </div>

      {/* key={status}: контент вкладки перемонтируется и мягко въезжает. */}
      <AppCard colorPrefix="w" key={status} className="anim-view-in p-5">
          {roadmapLoading ? (
            <p className="text-sm text-w-muted">Загрузка задач...</p>
          ) : filteredRoadmapTasks.length === 0 ? (
            <EmptyState colorPrefix="w"
              className="anim-view-in"
              title={status === 'open' ? 'Открытых roadmap-задач нет' : 'Закрытых roadmap-задач нет'}
              description="Назначьте студенту roadmap во вкладке студента — задачи появятся здесь."
            />
          ) : (
            <div className="anim-view-in space-y-3">
              {Object.entries(groupByStudent(filteredRoadmapTasks)).map(([groupStudentId, groupTasks]) => {
                const groupKey = `roadmap-${groupStudentId}`
                const expanded = !!expandedGroups[groupKey]
                const rows = groupTasks.map((task) => (
                  <RoadmapTaskRow
                    key={task.id}
                    task={task}
                    disabled={toggleRoadmapMutation.variables?.id === task.id}
                    onToggle={() => withViewTransition(() => toggleRoadmapMutation.mutate(task))}
                    onOpenQuestionnaire={() => setQuestionnaireTask(task)}
                  />
                ))
                return (
                  <StudentTaskGroup
                    key={groupKey}
                    studentName={groupTasks[0]?.student_name || 'Студент'}
                    total={groupTasks.length}
                    expanded={expanded}
                    onToggle={() => setExpandedGroups((current) => ({ ...current, [groupKey]: !expanded }))}
                    tail={rows.length > 5 ? rows.slice(5) : null}
                  >
                    {rows.slice(0, 5)}
                  </StudentTaskGroup>
                )
              })}
            </div>
          )}
      </AppCard>
      {questionnaireTask && (
        <WorkspaceQuestionnaireDialog
          taskId={questionnaireTask.id}
          taskTitle={questionnaireTask.title}
          studentId={questionnaireTask.student_id}
          open
          onClose={() => setQuestionnaireTask(null)}
        />
      )}
      <section className="mt-6">
        <PageHeader colorPrefix="w"
          eyebrow="Делегированные задачи"
          title="Очередь работы"
          description="Задачи, назначенные вам или вашей рабочей области, с контролем подписи и приемки."
        />
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <AppSelect colorPrefix="w" value={delegatedStatus} onChange={(event) => setDelegatedStatus(event.target.value as StudentTask['status'] | '')}>
            <option value="">Все статусы</option>
            {Object.entries(WORKFLOW_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </AppSelect>
          <AppSelect colorPrefix="w" value={delegatedPriority} onChange={(event) => setDelegatedPriority(event.target.value)}>
            <option value="">Все приоритеты</option>
            <option value="urgent">Срочные</option>
            <option value="high">Высокие</option>
            <option value="normal">Обычные</option>
            <option value="low">Низкие</option>
          </AppSelect>
        </div>
        <AppCard colorPrefix="w" className="p-5">
          {delegatedLoading ? <p className="text-sm text-w-muted">Загрузка очереди...</p> : delegatedTasks.length === 0 ? (
            <EmptyState colorPrefix="w" title="В очереди нет задач" description="Делегированные задачи появятся здесь после назначения исполнителя." />
          ) : (
            <div className="space-y-2">
              {delegatedTasks.map((task) => (
                <div key={task.id} className="flex flex-wrap items-center gap-3 rounded-panel border border-w-line bg-w-panel2 p-3">
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-bold text-w-ink">{task.task_text}</p>
                    <p className="mt-1 text-xs text-w-muted">{task.student_name || 'Студент'} · {task.assignee_name || 'Без исполнителя'}</p>
                  </div>
                  <span className="text-xs text-w-muted">{WORKFLOW_STATUS_LABEL[task.status]}</span>
                  <span className="text-xs font-bold text-w-accentText">{task.priority || 'normal'}</span>
                  {task.status === 'open' && task.assignee_id && (
                    <button type="button" className="rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-accentText hover:border-w-accentDim" onClick={() => delegatedMutation.mutate({ task, status: 'in_progress' })}>
                      В работу
                    </button>
                  )}
                  {task.status === 'in_progress' && (
                    <button type="button" className="rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-accentText hover:border-w-accentDim" onClick={() => delegatedMutation.mutate({ task, status: 'submitted' })}>
                      На проверку
                    </button>
                  )}
                  {task.status === 'submitted' && (
                    <>
                      <button
                        type="button"
                        className="rounded-ctl bg-w-good px-3 py-1.5 text-xs font-bold text-black hover:brightness-95"
                        onClick={() => {
                          setReviewTask(task)
                          setReviewDecision('accepted')
                          setReviewNote(task.review_note || '')
                        }}
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        className="rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-accentText hover:border-w-accentDim"
                        onClick={() => {
                          setReviewTask(task)
                          setReviewDecision('needs_revision')
                          setReviewNote(task.review_note || '')
                        }}
                      >
                        На доработку
                      </button>
                    </>
                  )}
                  {task.required_documents && task.required_documents.length > 0 && (
                    <button
                      type="button"
                      className="rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-accentText hover:border-w-accentDim"
                      onClick={() => {
                        setEvidenceTask(task)
                        setEvidenceRequirement(task.required_documents?.[0] || '')
                      }}
                    >
                      Подтверждение
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </AppCard>
      </section>
      {evidenceTask && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Загрузка подтверждения">
          <div className="w-full max-w-md rounded-card border border-w-line bg-w-panel p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-w-ink">Загрузить подтверждение</h2>
                <p className="mt-1 text-xs text-w-muted">{evidenceTask.task_text}</p>
              </div>
              <button type="button" className="text-xs text-w-muted hover:text-w-ink" onClick={() => setEvidenceTask(null)}>Закрыть</button>
            </div>
            <div className="space-y-3">
              <div className="rounded-panel border border-w-line bg-w-panel2 p-3">
                <p className="mb-2 text-xs font-bold text-w-ink">Загруженные подтверждения</p>
                {evidenceLoading ? <p className="text-xs text-w-muted">Загрузка списка...</p> : evidenceData?.length ? (
                  <div className="space-y-1.5">
                    {evidenceData.map((evidence) => (
                      <div key={evidence.id} className="flex items-center justify-between gap-2 text-xs text-w-muted">
                        <span className="truncate">{evidence.requirement || 'Без требования'}</span>
                        <span className="shrink-0 text-w-muted2">{evidence.file_name}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-w-muted">Пока нет загруженных файлов.</p>}
              </div>
              <AppSelect colorPrefix="w" value={evidenceRequirement} onChange={(event) => setEvidenceRequirement(event.target.value)}>
                <option value="">Выберите требование</option>
                {(evidenceTask.required_documents || []).map((document) => <option key={document} value={document}>{document}</option>)}
              </AppSelect>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)}
                className="block w-full text-xs text-w-muted file:mr-3 file:rounded-ctl file:border-0 file:bg-w-accent file:px-3 file:py-2 file:text-xs file:font-bold file:text-black"
              />
              <button
                type="button"
                disabled={!evidenceRequirement || !evidenceFile || evidenceMutation.isPending}
                onClick={() => evidenceMutation.mutate()}
                className="w-full rounded-ctl bg-w-accent px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {evidenceMutation.isPending ? 'Загрузка...' : 'Загрузить файл'}
              </button>
            </div>
          </div>
        </div>
      )}
      {reviewTask && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Проверка результата">
          <div className="w-full max-w-md rounded-card border border-w-line bg-w-panel p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-w-ink">Проверка результата</h2>
                <p className="mt-1 text-xs text-w-muted">{reviewTask.task_text}</p>
              </div>
              <button type="button" className="text-xs text-w-muted hover:text-w-ink" onClick={() => setReviewTask(null)}>Закрыть</button>
            </div>
            <div className="space-y-3">
              <AppSelect colorPrefix="w" value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as typeof reviewDecision)}>
                <option value="accepted">Принять результат</option>
                <option value="needs_revision">Вернуть на доработку</option>
              </AppSelect>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="Комментарий проверки..."
                rows={4}
                className="w-full rounded-ctl border border-w-line bg-w-panel2 p-3 text-sm text-w-ink outline-none focus:border-w-accentDim"
              />
              <button
                type="button"
                disabled={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate()}
                className="w-full rounded-ctl bg-w-accent px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewMutation.isPending ? 'Сохранение...' : 'Сохранить решение'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function groupByStudent<T extends { student_id: string }>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const studentItems = (groups[item.student_id] ||= [])
    studentItems.push(item)
    return groups
  }, {})
}

function StudentTaskGroup({
  studentName,
  total,
  expanded,
  onToggle,
  tail,
  children,
}: {
  studentName: string
  total: number
  expanded: boolean
  onToggle: () => void
  /** Хвост «Показать остальные»: всегда смонтирован, высота анимируется. */
  tail?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-w-line bg-w-panel p-3">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-black text-w-ink">{studentName}</h2>
          <p className="mt-0.5 text-[11px] text-w-muted">{total} задач</p>
        </div>
        {total > 5 && (
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText"
          >
            {expanded ? 'Скрыть остальные' : `Показать остальные · ${total - 5}`}
            <ChevronDown className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      <div className="space-y-2">{children}</div>
      {tail != null && (
        <div className="expandable" data-open={expanded}>
          <div>
            <div className="space-y-2 pt-2">{tail}</div>
          </div>
        </div>
      )}
    </section>
  )
}

function RoadmapTaskRow({
  task,
  disabled,
  onToggle,
  onOpenQuestionnaire,
}: {
  task: WorkspaceRoadmapTask
  disabled?: boolean
  onToggle: () => void
  onOpenQuestionnaire: () => void
}) {
  const done = task.status === 'done'
  return (
    <div className="flex items-start gap-3 rounded-panel border border-w-line bg-w-panel2 p-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition active:scale-[0.98]',
          done ? 'border-w-good bg-w-good text-black' : 'border-w-line text-w-muted hover:border-w-accentDim hover:text-w-accentText',
          disabled && 'cursor-wait opacity-60'
        )}
        aria-label={done ? 'Вернуть в работу' : 'Закрыть задачу'}
      >
        {done && <CheckCircle2 className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm font-bold', done ? 'text-w-muted line-through' : 'text-w-ink')}>{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-w-muted">
          <Link to={`/workspace/students/${task.student_id}#roadmap`} className="inline-flex items-center gap-1 text-w-accentText hover:underline">
            <Route className="h-3 w-3" /> {task.student_name}
          </Link>
          <span>·</span>
          <span>{task.stage_name}</span>
          {task.due_date && (
            <>
              <span>·</span>
              <span className="tabular-nums">до {formatDate(task.due_date)}</span>
            </>
          )}
          <UrgencyBadge dueDate={task.due_date} status={task.status} />
          {task.subtasks_total > 0 && (
            <>
              <span>·</span>
              <span>{task.subtasks_done}/{task.subtasks_total} подзадач</span>
            </>
          )}
          {task.audience === 'coordinator' && <span className="text-w-muted2">координатор</span>}
          {task.needs_document && <span className="inline-flex items-center gap-1 text-w-muted2"><FileUp className="h-3 w-3" /> документ</span>}
          {task.needs_zoom && <span className="inline-flex items-center gap-1 text-w-muted2"><Video className="h-3 w-3" /> zoom</span>}
          {task.has_questionnaire && <button type="button" onClick={onOpenQuestionnaire} className="inline-flex items-center gap-1 font-bold text-w-accentText hover:underline"><ClipboardList className="h-3 w-3" /> Открыть анкету</button>}
        </div>
      </div>
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide',
          task.priority === 'required' && 'bg-w-accent text-black',
          task.priority === 'recommended' && 'border border-w-accentDim/60 text-w-accentText',
          task.priority === 'optional' && 'border border-w-line text-w-muted2'
        )}
      >
        {PRIORITY_LABEL[task.priority] || task.priority}
      </span>
    </div>
  )
}
