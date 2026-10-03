import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import { roadmapApi } from '@/api/roadmap'
import { workspaceApi } from '@/api/workspace'
import { tasksApi } from '@/api'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { useAuth } from '@/contexts/AuthContext'
import type { StudentTask } from '@/types'
import { cn } from '@/lib/utils'
import { getErrorMessage, getErrorStatus } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { AppButton, AppSelect, EmptyState, PageHeader } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { CreateTaskDialog } from '@/components/shared/CreateTaskDialog'
import { WorkspaceQuestionnaireDialog } from '@/components/workspace/WorkspaceQuestionnaireDialog'
import { TaskQueue, type RowActions } from '@/components/workspace/tasks/TaskQueue'
import { StudentsOverview } from '@/components/workspace/tasks/StudentsOverview'
import { EvidenceDialog, ReviewDialog } from '@/components/workspace/tasks/TaskDialogs'
import { TaskDetailPanel } from '@/components/workspace/tasks/TaskDetailPanel'
import {
  BUCKET_LABEL,
  applyBaseFilter,
  countBuckets,
  filterByBucket,
  fromDelegated,
  fromRoadmap,
  isClosed,
  rollupByStudent,
  sortItems,
  type DueBucket,
  type SortDir,
  type SortKey,
  type WorkItem,
  type WorkKind,
} from '@/components/workspace/tasks/workItems'

type Tab = 'queue' | 'review' | 'students' | 'closed'

const PAGE_SIZE = 40

/** Сервер отдаёт поручения страницами по 200: берём все, иначе очередь молча обрезалась бы на 200-й задаче. */
const DELEGATED_PAGE = 200
const DELEGATED_MAX_PAGES = 10

async function fetchAllDelegated(params: Parameters<typeof tasksApi.listAll>[0]) {
  const items: StudentTask[] = []
  for (let page = 1; page <= DELEGATED_MAX_PAGES; page += 1) {
    const result = await tasksApi.listAll({ ...params, size: DELEGATED_PAGE, page })
    items.push(...result.items)
    if (result.items.length === 0 || page >= (result.pages ?? 1)) break
  }
  return { items }
}

const BUCKETS: Array<DueBucket | 'all'> = ['all', 'overdue', 'today', 'week', 'none']

export const WorkspaceTasksPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { params } = useWorkspaceScope()
  const { can } = useAuth()
  // Задачу можно поставить двумя путями: шагом roadmap студенту или поручением сотруднику.
  const canCreate = can('tasks', 'manage') || can('roadmaps', 'edit')

  const [tab, setTab] = useLocalState<Tab>('workspace:tasks:v2:tab', 'queue')
  const [kind, setKind] = useLocalState<WorkKind | 'all'>('workspace:tasks:v2:kind', 'all')
  const [bucket, setBucket] = useLocalState<DueBucket | 'all'>('workspace:tasks:v2:bucket', 'all')
  const [query, setQuery] = useState('')
  const [urlParams] = useSearchParams()
  const [studentId, setStudentId] = useState(urlParams.get('student_id') ?? '')
  React.useEffect(() => {
    if (!urlParams.has('student_id')) return
    setStudentId(urlParams.get('student_id') ?? '')
    setTab(urlParams.get('view') === 'review' ? 'review' : 'queue')
    setKind('all'); setBucket('all'); setQuery('')
  }, [urlParams, setTab, setKind, setBucket])
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'due', dir: 'asc' })
  const [visible, setVisible] = useState(PAGE_SIZE)

  const [creating, setCreating] = useState<{ student: { id: string; name: string } | null } | null>(null)
  const [questionnaire, setQuestionnaire] = useState<WorkItem | null>(null)
  const [reviewing, setReviewing] = useState<{ item: WorkItem; decision: 'accept' | 'return' } | null>(null)
  const [evidence, setEvidence] = useState<WorkItem | null>(null)
  // Панель хранит ключ, а не саму задачу: после действия она показывает свежие данные из списка.
  const [detailKey, setDetailKey] = useState<string | null>(null)

  const wantClosed = tab === 'closed'

  // ---- данные: шаги roadmap и поручения — два источника, одна очередь ----
  const openRoadmap = useQuery({
    queryKey: ['workspace', 'roadmap-tasks', 'open', params],
    queryFn: () => workspaceApi.roadmapTasks({ ...params, status: 'open' }),
  })
  const doneRoadmap = useQuery({
    queryKey: ['workspace', 'roadmap-tasks', 'done', params],
    queryFn: () => workspaceApi.roadmapTasks({ ...params, status: 'done' }),
    enabled: wantClosed,
  })
  const delegated = useQuery({
    queryKey: ['workspace', 'delegated-tasks', params],
    queryFn: () => fetchAllDelegated(params),
  })
  const studentsQuery = useQuery({
    queryKey: ['workspace', 'tasks', 'students', params],
    queryFn: () => workspaceApi.students(params),
  })

  const students = useMemo(() => studentsQuery.data?.items ?? [], [studentsQuery.data])

  const allItems = useMemo<WorkItem[]>(() => {
    const today = new Date()
    const roadmap = [...(openRoadmap.data?.items ?? []), ...(wantClosed ? doneRoadmap.data?.items ?? [] : [])]
    return [
      ...roadmap.map((task) => fromRoadmap(task, today)),
      ...(delegated.data?.items ?? []).map((task) => fromDelegated(task, today)),
    ]
  }, [openRoadmap.data, doneRoadmap.data, delegated.data, wantClosed])

  const openItems = useMemo(() => allItems.filter((item) => !isClosed(item.status)), [allItems])
  const reviewCount = useMemo(() => openItems.filter((item) => item.status === 'review').length, [openItems])

  const tabItems = useMemo(() => {
    if (tab === 'closed') return allItems.filter((item) => isClosed(item.status))
    if (tab === 'review') return openItems.filter((item) => item.status === 'review')
    return openItems
  }, [tab, allItems, openItems])

  const baseFiltered = useMemo(
    () => applyBaseFilter(tabItems, { query, kind, studentId: studentId || undefined }),
    [tabItems, query, kind, studentId],
  )
  const counts = useMemo(() => countBuckets(baseFiltered), [baseFiltered])
  const listed = useMemo(
    () => sortItems(filterByBucket(baseFiltered, tab === 'closed' ? 'all' : bucket), sort.key, sort.dir),
    [baseFiltered, bucket, tab, sort],
  )
  const rollups = useMemo(() => rollupByStudent(openItems), [openItems])

  const focusedStudentName = studentId
    ? allItems.find((item) => item.studentId === studentId)?.studentName ??
      students.find((s) => s.student.id === studentId)?.student.full_name ??
      'студент'
    : null

  // ---- действия ----
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap-tasks'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'delegated-tasks'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  const run = useMutation({
    mutationFn: async ({ item, action }: { item: WorkItem; action: () => Promise<unknown> }) => {
      await action()
      return item
    },
    onSuccess: refresh,
    onError: (error) => {
      const conflict = getErrorStatus(error) === 409
      toast({
        title: conflict ? 'Задачу уже изменили' : 'Не удалось выполнить действие',
        description: conflict ? 'Список обновлён.' : getErrorMessage(error),
        variant: 'destructive',
      })
      if (conflict) refresh()
    },
  })
  const busyKey = run.isPending ? run.variables?.item.key ?? null : null

  const actions: RowActions = {
    busyKey,
    onToggleRoadmap: (item) =>
      run.mutate({
        item,
        action: () => roadmapApi.updateTask(item.id, { status: item.status === 'done' ? 'planned' : 'done' }),
      }),
    onApproveRoadmap: (item) =>
      run.mutate({ item, action: () => roadmapApi.reviewTask(item.id, { action: 'approve' }) }),
    onReview: (item, decision) => setReviewing({ item, decision }),
    onDelegatedStatus: (item, status) => run.mutate({ item, action: () => tasksApi.update(item.id, { status }) }),
    onEvidence: setEvidence,
    onQuestionnaire: setQuestionnaire,
    onOpen: (item) => setDetailKey(item.key),
  }
  const detailItem = detailKey ? allItems.find((item) => item.key === detailKey) ?? null : null

  const onSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const resetFilters = () => {
    setQuery('')
    setKind('all')
    setBucket('all')
    setStudentId('')
  }
  const hasFilters = Boolean(query || kind !== 'all' || bucket !== 'all' || studentId)

  const loading = openRoadmap.isLoading || delegated.isLoading
  const failed = openRoadmap.isError || delegated.isError
  const failure = openRoadmap.error ?? delegated.error
  const retry = () => {
    void openRoadmap.refetch()
    void delegated.refetch()
  }

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'queue', label: 'Очередь', count: openItems.length },
    { value: 'review', label: 'На проверке', count: reviewCount },
    { value: 'students', label: 'По студентам' },
    { value: 'closed', label: 'Закрытые' },
  ]

  return (
    <div className="fade-in">
      <PageHeader
        colorPrefix="w"
        eyebrow="Кабинет ментора"
        title="Задачи"
        description="Шаги roadmap и поручения по вашим студентам в одном списке: что горит, что ждёт проверки, кому ещё не поставили задачу."
        action={
          canCreate ? (
            <AppButton colorPrefix="w" onClick={() => setCreating({ student: null })}>
              <Plus className="h-4 w-4" aria-hidden />Новая задача
            </AppButton>
          ) : undefined
        }
      />

      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-w-line">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            onClick={() => {
              setTab(item.value)
              setVisible(PAGE_SIZE)
            }}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-bold transition-colors',
              tab === item.value ? 'border-w-accent text-w-ink' : 'border-transparent text-w-muted hover:text-w-ink',
            )}
          >
            {item.label}
            {item.count != null && item.count > 0 && (
              <span className={cn('ml-1.5 text-xs tabular-nums', tab === item.value ? 'text-w-accentText' : 'text-w-muted2')}>
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-w-muted2" aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setVisible(PAGE_SIZE)
            }}
            placeholder={tab === 'students' ? 'Найти студента' : 'Задача или студент'}
            aria-label="Поиск"
            className="h-10 w-full rounded-ctl border border-w-line bg-w-panel pl-9 pr-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
        </label>

        {tab !== 'students' && (
          <AppSelect
            colorPrefix="w"
            aria-label="Тип задачи"
            value={kind}
            onChange={(event) => setKind(event.target.value as WorkKind | 'all')}
          >
            <option value="all">Все типы</option>
            <option value="roadmap">Шаги roadmap</option>
            <option value="delegated">Поручения</option>
          </AppSelect>
        )}

        {focusedStudentName && (
          <button
            type="button"
            onClick={() => setStudentId('')}
            className="inline-flex h-10 items-center gap-1.5 rounded-ctl border border-w-accentDim/60 px-3 text-xs font-bold text-w-accentText transition hover:bg-w-accent/10"
          >
            {focusedStudentName}
            <X className="h-3.5 w-3.5" aria-label="Убрать фильтр по студенту" />
          </button>
        )}

        {(tab === 'queue' || tab === 'review') && (
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto" role="group" aria-label="Фильтр по сроку">
            {BUCKETS.map((value) => {
              const active = bucket === value
              const count = counts[value]
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setBucket(value)
                    setVisible(PAGE_SIZE)
                  }}
                  className={cn(
                    'h-8 rounded-full border px-3 text-xs font-bold transition',
                    active
                      ? 'border-w-ink bg-w-ink text-w-bg'
                      : 'border-w-line text-w-muted hover:border-w-accentDim hover:text-w-ink',
                  )}
                >
                  {value === 'all' ? 'Все' : BUCKET_LABEL[value]}
                  <span
                    className={cn(
                      'ml-1.5 tabular-nums',
                      !active && value === 'overdue' && count > 0 ? 'text-w-danger' : active ? 'opacity-70' : 'text-w-muted2',
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <QueryState
        colorPrefix="w"
        isLoading={loading}
        isError={failed}
        error={failure}
        onRetry={retry}
        isEmpty={false}
      >
        {tab === 'students' ? (
          <StudentsOverview
            students={students}
            rollups={rollups}
            query={query}
            canCreate={canCreate}
            onCreate={(student) => setCreating({ student })}
            onFocusStudent={(id) => {
              setStudentId(id)
              setBucket('all')
              setTab('queue')
            }}
          />
        ) : listed.length === 0 ? (
          <div className="rounded-card border border-w-line bg-w-panel">
            <EmptyState
              colorPrefix="w"
              title={hasFilters ? 'По этим условиям ничего нет' : emptyTitle(tab)}
              description={hasFilters ? 'Сбросьте фильтры или измените поиск.' : emptyHint(tab)}
              action={hasFilters ? <AppButton colorPrefix="w" variant="subtle" onClick={resetFilters}>Сбросить фильтры</AppButton> : undefined}
            />
          </div>
        ) : (
          <>
            <TaskQueue items={listed.slice(0, visible)} actions={actions} sortKey={sort.key} sortDir={sort.dir} onSort={onSort} />
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-w-muted">
              <span className="tabular-nums">Показано {Math.min(visible, listed.length)} из {listed.length}</span>
              {listed.length > visible && (
                <button
                  type="button"
                  onClick={() => setVisible((current) => current + PAGE_SIZE)}
                  className="rounded-ctl border border-w-line px-3 py-1.5 font-bold text-w-ink transition hover:border-w-accentDim"
                >
                  Показать ещё
                </button>
              )}
            </div>
          </>
        )}
      </QueryState>

      {detailItem && (
        <TaskDetailPanel item={detailItem} actions={actions} onClose={() => setDetailKey(null)} onChanged={refresh} />
      )}
      {questionnaire?.roadmap && (
        <WorkspaceQuestionnaireDialog
          taskId={questionnaire.id}
          taskTitle={questionnaire.title}
          studentId={questionnaire.roadmap.student_id}
          open
          onClose={() => setQuestionnaire(null)}
        />
      )}
      {reviewing && (
        <ReviewDialog
          item={reviewing.item}
          initialDecision={reviewing.decision}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null)
            refresh()
          }}
        />
      )}
      {evidence && (
        <EvidenceDialog
          item={evidence}
          onClose={() => setEvidence(null)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['workspace', 'task-evidence', evidence.id] })
            refresh()
          }}
        />
      )}
      {creating && (
        <CreateTaskDialog
          colorPrefix="w"
          defaultStudent={creating.student}
          onClose={() => setCreating(null)}
          onCreated={() => {
            refresh()
            setCreating(null)
          }}
        />
      )}
    </div>
  )
}

function emptyTitle(tab: Tab): string {
  if (tab === 'review') return 'Ничего не ждёт проверки'
  if (tab === 'closed') return 'Закрытых задач пока нет'
  return 'Открытых задач нет'
}

function emptyHint(tab: Tab): string {
  if (tab === 'review') return 'Когда студент отметит шаг выполненным или сотрудник сдаст поручение, он появится здесь.'
  if (tab === 'closed') return 'Принятые и закрытые задачи окажутся здесь.'
  return 'Назначьте студенту roadmap или поставьте поручение кнопкой «Новая задача».'
}
