import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ClipboardList, FileUp, Route, Video } from 'lucide-react'
import { roadmapApi } from '@/api/roadmap'
import { workspaceApi, WorkspaceRoadmapTask } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { WorkspaceQuestionnaireDialog } from '@/components/workspace/WorkspaceQuestionnaireDialog'
import {
  WorkspaceCard,
  WorkspaceEmptyState,
  WorkspacePageHeader,
  WorkspaceSegmentedTabs,
  WorkspaceSelect,
} from '@/components/workspace/ui'

const PRIORITY_LABEL: Record<string, string> = {
  required: 'Обязательно',
  recommended: 'Желательно',
  optional: 'По желанию',
}

export const WorkspaceTasksPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { params } = useWorkspaceScope()
  const [status, setStatus] = useLocalState<'open' | 'done'>('workspace:tasks:status', 'open')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:tasks:studentFilter', '')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [questionnaireTask, setQuestionnaireTask] = useState<WorkspaceRoadmapTask | null>(null)

  // ---- roadmap tasks (student-facing) ----
  const { data: roadmapData, isLoading: roadmapLoading } = useQuery({
    queryKey: ['workspace', 'roadmap-tasks', status, params],
    queryFn: () => workspaceApi.roadmapTasks({ ...params, status }),
  })

  const { data: studentsData } = useQuery({
    queryKey: ['workspace', 'tasks', 'students', params],
    queryFn: () => workspaceApi.students(params),
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
      <WorkspacePageHeader
        eyebrow="Кабинет ментора"
        title="Задачи"
        description="Roadmap-задачи ваших студентов в одном рабочем списке."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <WorkspaceSegmentedTabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Открытые' },
            { value: 'done', label: 'Закрытые' },
          ]}
        />
        <WorkspaceSelect
          value={studentFilter}
          onChange={(event) => setStudentFilter(event.target.value)}
          className="bg-w-panel2 md:min-w-[240px]"
        >
          <option value="">Все студенты</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name}</option>
          ))}
        </WorkspaceSelect>
      </div>

      <WorkspaceCard className="p-5">
          {roadmapLoading ? (
            <p className="text-sm text-w-muted">Загрузка задач...</p>
          ) : filteredRoadmapTasks.length === 0 ? (
            <WorkspaceEmptyState
              title={status === 'open' ? 'Открытых roadmap-задач нет' : 'Закрытых roadmap-задач нет'}
              text="Назначьте студенту roadmap во вкладке студента — задачи появятся здесь."
            />
          ) : (
            <div className="space-y-3">
              {Object.entries(groupByStudent(filteredRoadmapTasks)).map(([groupStudentId, groupTasks]) => {
                const groupKey = `roadmap-${groupStudentId}`
                const expanded = !!expandedGroups[groupKey]
                return (
                  <StudentTaskGroup
                    key={groupKey}
                    studentName={groupTasks[0]?.student_name || 'Студент'}
                    total={groupTasks.length}
                    expanded={expanded}
                    onToggle={() => setExpandedGroups((current) => ({ ...current, [groupKey]: !expanded }))}
                  >
                    {groupTasks.slice(0, expanded ? undefined : 5).map((task) => (
                      <RoadmapTaskRow
                        key={task.id}
                        task={task}
                        disabled={toggleRoadmapMutation.variables?.id === task.id}
                        onToggle={() => toggleRoadmapMutation.mutate(task)}
                        onOpenQuestionnaire={() => setQuestionnaireTask(task)}
                      />
                    ))}
                  </StudentTaskGroup>
                )
              })}
            </div>
          )}
      </WorkspaceCard>
      {questionnaireTask && (
        <WorkspaceQuestionnaireDialog
          taskId={questionnaireTask.id}
          taskTitle={questionnaireTask.title}
          studentId={questionnaireTask.student_id}
          open
          onClose={() => setQuestionnaireTask(null)}
        />
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
  children,
}: {
  studentName: string
  total: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[18px] border border-w-line bg-w-panel p-3">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-black text-w-ink">{studentName}</h2>
          <p className="mt-0.5 text-[11px] text-w-muted">{total} задач</p>
        </div>
        {total > 5 && (
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-w-line px-3 py-1.5 text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText"
          >
            {expanded ? 'Скрыть остальные' : `Показать остальные · ${total - 5}`}
            <ChevronDown className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      <div className="space-y-2">{children}</div>
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
  const overdue = !done && task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())
  return (
    <div className="flex items-start gap-3 rounded-[16px] border border-w-line bg-w-panel2 p-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition',
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
              <span className={cn('tabular-nums', overdue && 'font-bold text-w-danger')}>до {formatDate(task.due_date)}</span>
            </>
          )}
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
