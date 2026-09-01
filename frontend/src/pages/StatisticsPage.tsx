import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileWarning,
  MessageCircle,
  Route as RouteIcon,
  Sparkles,
  Users,
} from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import {
  DEGREE_LEVEL_LABELS,
  PIPELINE_COLUMNS,
  PIPELINE_STATUS_COLORS,
  PIPELINE_STATUS_LABELS,
  PipelineStatus,
  SERVICE_TYPE_LABELS,
  ServiceType,
  StudentListItem,
} from '@/types'
import { PageHeader, SegmentedTabs } from '@/components/ui'
import { FilterChips, FilterField, FilterPopover, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory } from '@/hooks/useStudentDirectory'
import { StatCard } from '@/components/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import { QueryError } from '@/components/shared/QueryState'

type ListScope = 'all' | 'mine' | 'assigned' | 'unassigned'

// Секции страницы — чисто визуальная группировка уже существующих блоков.
type StatsSection = 'overview' | 'funnel-risks' | 'services' | 'team'

const STATS_SECTION_TABS: { value: StatsSection; label: string }[] = [
  { value: 'overview', label: 'Обзор' },
  { value: 'funnel-risks', label: 'Воронка и риски' },
  { value: 'services', label: 'Услуги' },
  { value: 'team', label: 'Команда' },
]

type RiskGroup = 'healthy' | 'attention' | 'risk' | 'neutral'

const PIPELINE_RISK_GROUP: Record<PipelineStatus, RiskGroup> = {
  active_work: 'healthy',
  on_visa: 'risk',
  paused: 'attention',
  changed_mind: 'neutral',
  refund: 'risk',
  unpaid: 'attention',
  transferred_pipeline: 'risk',
  ielts_retake: 'attention',
  suspended: 'risk',
  no_status: 'neutral',
}

const RISK_GROUP_BAR_CLASS: Record<RiskGroup, string> = {
  healthy: 'bg-emerald-500',
  attention: 'bg-amber-500',
  risk: 'bg-red-500',
  neutral: 'bg-gray-400',
}

const RISK_GROUP_LABELS: Record<RiskGroup, string> = {
  healthy: 'В норме',
  attention: 'Внимание',
  risk: 'Риск',
  neutral: 'Нейтрально',
}

type AgingBucket = 'low' | 'medium' | 'high'

function agingBucket(days: number): AgingBucket {
  if (days > 60) return 'high'
  if (days > 30) return 'medium'
  return 'low'
}

const AGING_BUCKET_LABELS: Record<Exclude<AgingBucket, 'low'>, string> = {
  medium: '31-60 дней',
  high: '60+ дней',
}

const AGING_BUCKET_STYLE: Record<Exclude<AgingBucket, 'low'>, string> = {
  medium: 'bg-amber-50 text-amber-700 border border-amber-200',
  high: 'bg-red-50 text-red-700 border border-red-200',
}

type WorkloadRow = {
  mentor: { id: string; name: string }
  roles: string[]
  students_total: number
  open_tasks: number
  overdue_tasks: number
  sla_penalties_this_month: number
  telegram_signals: number
  documents_unverified: number
  ai_drafts: number
  health_warnings: number
}

type WorkloadSortKey = Exclude<keyof WorkloadRow, 'mentor' | 'roles'>

// Просрочки и SLA-нарушения раньше сюда не доезжали — эта же сводка держала
// только нейтральные сигналы, хотя регламент ведёт цветовые санкции ровно за
// то, чего в ней не было видно (task_sla.py). "Просрочек" — задачи, которые
// уже светятся жёлтым/оранжевым/красным/чёрным на «Моём дне» (task_urgency),
// просуммированные по назначенным студентам. "SLA, месяц" — фактические
// санкции (backend: MentorTaskPenalty) за календарный месяц, то же окно, в
// котором сам регламент считает ступень нарушения.
const WORKLOAD_COLUMNS: { key: WorkloadSortKey; label: string }[] = [
  { key: 'students_total', label: 'Студентов' },
  { key: 'open_tasks', label: 'Задач' },
  { key: 'overdue_tasks', label: 'Просрочек' },
  { key: 'sla_penalties_this_month', label: 'SLA, месяц' },
  { key: 'telegram_signals', label: 'Telegram' },
  { key: 'documents_unverified', label: 'Документы' },
  { key: 'ai_drafts', label: 'AI-черновики' },
  { key: 'health_warnings', label: 'Сигналы' },
]

function pipelineOf(student: StudentListItem): PipelineStatus {
  return (student.pipeline_status || 'no_status') as PipelineStatus
}

function studentResponsibles(student: StudentListItem): string {
  const names = (student.mentors ?? []).slice(0, 2)
  if (names.length > 0) return names.join(', ')
  const fallback = (student.responsibles ?? []).filter((r) => r.is_active && r.name).map((r) => r.name as string)
  return fallback.slice(0, 2).join(', ') || 'Не назначен'
}

function isServiceOverdue(deadline: string | null | undefined, status: string): boolean {
  if (!deadline) return false
  if (status === 'completed' || status === 'not_applicable' || status === 'failed') return false
  const todayIso = new Date().toISOString().slice(0, 10)
  return deadline.slice(0, 10) < todayIso
}

export function StatisticsPage() {
  const [scope, setScope] = useState<ListScope>('all')
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | ''>('')
  const [yearFilter, setYearFilter] = useState('')
  const [degreeFilter, setDegreeFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [responsibleIdFilter, setResponsibleIdFilter] = useState('')
  const [workloadSort, setWorkloadSort] = useState<{ key: WorkloadSortKey; dir: 'asc' | 'desc' }>({
    key: 'students_total',
    dir: 'desc',
  })
  const [section, setSection] = useState<StatsSection>('overview')

  const directory = useStudentDirectory()
  const workspaceScope = scope === 'mine' ? 'mine' : 'all'

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['statistics', 'workspace-dashboard', workspaceScope],
    queryFn: () => workspaceApi.dashboard({ scope: workspaceScope }),
  })

  const studentsLoading = directory.isLoading
  // Вся страница считается от этого справочника: при обрыве связи каждый
  // график и каждая плитка честно рисовали нули по пустому массиву.
  const studentsFailed = directory.isError

  // Все фильтры — на клиенте, поверх уже загруженного общего списка студентов
  // (useStudentDirectory, один кэшируемый фетч на всё приложение). Раньше смена
  // любого из фильтров ниже тянула с сервера заново до 2000 студентов.
  const students = useMemo(() => {
    return directory.students.filter((student) => {
      if (scope === 'mine' && !student.is_mine) return false
      if (scope === 'assigned' && !(student.responsible_count ?? 0)) return false
      if (scope === 'unassigned' && (student.responsible_count ?? 0) > 0) return false
      if (statusFilter && pipelineOf(student) !== statusFilter) return false
      if (yearFilter && String(student.intake_year) !== yearFilter) return false
      if (degreeFilter && student.degree_level !== degreeFilter) return false
      if (countryFilter && (student.country ?? '').toLowerCase() !== countryFilter.toLowerCase()) return false
      if (
        responsibleIdFilter &&
        !(student.responsibles ?? []).some((responsible) => responsible.id === responsibleIdFilter && responsible.is_active)
      )
        return false
      return true
    })
  }, [directory.students, scope, statusFilter, yearFilter, degreeFilter, countryFilter, responsibleIdFilter])

  const statusCounts = useMemo(() => {
    const counts = new Map<PipelineStatus, number>()
    PIPELINE_COLUMNS.forEach((status) => counts.set(status, 0))
    students.forEach((student) => {
      const status = pipelineOf(student)
      counts.set(status, (counts.get(status) ?? 0) + 1)
    })
    return counts
  }, [students])

  const funnel = useMemo(() =>
    PIPELINE_COLUMNS.map((status) => ({
      status,
      label: PIPELINE_STATUS_LABELS[status],
      count: statusCounts.get(status) ?? 0,
      riskGroup: PIPELINE_RISK_GROUP[status],
    })), [statusCounts])

  const funnelMax = Math.max(1, ...funnel.map((row) => row.count))

  const riskList = useMemo(() => {
    return students
      .map((student) => {
        const status = pipelineOf(student)
        const pipelineRisk = PIPELINE_RISK_GROUP[status] === 'risk'
        const bucket = agingBucket(student.days_in_work ?? 0)
        return { student, status, pipelineRisk, bucket }
      })
      .filter((row) => row.pipelineRisk || row.bucket !== 'low')
      .sort((a, b) => {
        const weight = (r: typeof a) => (r.pipelineRisk ? 2 : 0) + (r.bucket === 'high' ? 2 : r.bucket === 'medium' ? 1 : 0)
        const diff = weight(b) - weight(a)
        if (diff !== 0) return diff
        return (b.student.days_in_work ?? 0) - (a.student.days_in_work ?? 0)
      })
      .slice(0, 15)
  }, [students])

  // Только для подписи «Показаны X из N» под таблицей — сам riskList не меняется.
  const riskTotal = useMemo(() => {
    return students.filter((student) => {
      const status = pipelineOf(student)
      return PIPELINE_RISK_GROUP[status] === 'risk' || agingBucket(student.days_in_work ?? 0) !== 'low'
    }).length
  }, [students])

  const countryTop = useMemo(() => {
    const map = new Map<string, number>()
    students.forEach((student) => {
      if (!student.country) return
      map.set(student.country, (map.get(student.country) ?? 0) + 1)
    })
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [students])
  const degreeStats = useMemo(() => {
    const map = new Map<string, number>()
    students.forEach((student) => {
      map.set(student.degree_level, (map.get(student.degree_level) ?? 0) + 1)
    })
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [students])

  const workload = useMemo(
    () => (dashboard?.workload ?? []) as WorkloadRow[],
    [dashboard?.workload],
  )
  const healthSignals = dashboard?.health_signals ?? []

  const workloadAvgStudents = useMemo(() => {
    if (workload.length === 0) return 0
    return workload.reduce((sum, row) => sum + (row.students_total ?? 0), 0) / workload.length
  }, [workload])

  const sortedWorkload = useMemo(() => {
    const arr = [...workload]
    arr.sort((a, b) => {
      const diff = (a[workloadSort.key] ?? 0) - (b[workloadSort.key] ?? 0)
      return workloadSort.dir === 'asc' ? diff : -diff
    })
    return arr
  }, [workload, workloadSort])

  const toggleWorkloadSort = (key: WorkloadSortKey) => {
    setWorkloadSort((current) =>
      current.key === key ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    )
  }

  const serviceStats = useMemo(() => {
    const byType = new Map<ServiceType, { total: number; in_progress: number; scheduled: number; completed: number; overdue: number }>()
    const overdueItems: { student_name: string; service_type: ServiceType; deadline: string }[] = []
    students.forEach((student) => {
      (student.services_summary?.items ?? []).forEach((item) => {
        const cur = byType.get(item.service_type) ?? { total: 0, in_progress: 0, scheduled: 0, completed: 0, overdue: 0 }
        cur.total += 1
        if (item.status === 'in_progress') cur.in_progress += 1
        if (item.status === 'scheduled') cur.scheduled += 1
        if (item.status === 'completed') cur.completed += 1
        if (isServiceOverdue(item.deadline, item.status)) {
          cur.overdue += 1
          overdueItems.push({ student_name: student.full_name, service_type: item.service_type, deadline: item.deadline as string })
        }
        byType.set(item.service_type, cur)
      })
    })
    return {
      byType: [...byType.entries()].sort((a, b) => b[1].total - a[1].total),
      overdueItems: overdueItems.sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 8),
      overdueTotal: overdueItems.length,
    }
  }, [students])

  const stats = useMemo(() => {
    const total = students.length
    const noRoadmap = students.filter((student) => !student.roadmap?.id).length
    const openInternal = students.reduce((sum, student) => sum + (student.open_tasks_count ?? 0), 0)
    const openRoadmap = students.reduce((sum, student) => {
      const totalTasks = student.roadmap?.tasks_total ?? 0
      const doneTasks = student.roadmap?.tasks_done ?? 0
      return sum + Math.max(totalTasks - doneTasks, 0)
    }, 0)
    const telegramSignals = students.reduce((sum, student) => sum + (student.telegram?.pending_signals ?? 0), 0)
    const docsUnverified = students.reduce((sum, student) => sum + (student.documents_unverified ?? 0), 0)
    const portalMissing = students.filter((student) => !student.has_portal_access).length
    const withNextMeeting = students.filter((student) => !!student.next_meeting).length
    return {
      students_total: total,
      active_work: statusCounts.get('active_work') ?? 0,
      without_roadmap: noRoadmap,
      open_internal_tasks: openInternal,
      open_roadmap_tasks: openRoadmap,
      telegram_signals: telegramSignals,
      documents_unverified: docsUnverified,
      without_portal: portalMissing,
      with_next_meeting: withNextMeeting,
    }
  }, [students, statusCounts])

  const activeFiltersCount =
    (scope !== 'all' ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (yearFilter ? 1 : 0) +
    (degreeFilter ? 1 : 0) +
    (countryFilter ? 1 : 0) +
    (responsibleIdFilter ? 1 : 0)

  const responsibleName = (id: string) => directory.responsibleUsers.find((user) => user.id === id)?.name ?? id
  const resetFilters = () => {
    setScope('all')
    setStatusFilter('')
    setYearFilter('')
    setDegreeFilter('')
    setCountryFilter('')
    setResponsibleIdFilter('')
  }

  const filterChips = [
    scope !== 'all' && {
      key: 'scope',
      label: scope === 'mine' ? 'Скоуп: мои' : scope === 'assigned' ? 'Скоуп: назначенные' : 'Скоуп: без ответственного',
      onRemove: () => setScope('all'),
    },
    statusFilter && { key: 'status', label: `Статус: ${PIPELINE_STATUS_LABELS[statusFilter]}`, onRemove: () => setStatusFilter('') },
    yearFilter && { key: 'year', label: `Год: ${yearFilter}`, onRemove: () => setYearFilter('') },
    degreeFilter && { key: 'degree', label: `Ступень: ${DEGREE_LEVEL_LABELS[degreeFilter as keyof typeof DEGREE_LEVEL_LABELS] ?? degreeFilter}`, onRemove: () => setDegreeFilter('') },
    countryFilter && { key: 'country', label: `Страна: ${countryFilter}`, onRemove: () => setCountryFilter('') },
    responsibleIdFilter && { key: 'responsible', label: `Ответственный: ${responsibleName(responsibleIdFilter)}`, onRemove: () => setResponsibleIdFilter('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Статистика"
        description="Операционная сводка по студентам, рискам и нагрузке. Финансовые показатели — на отдельной странице «Финансы»."
      />

      <SegmentedTabs
        className="mb-5"
        colorPrefix="p"
        tabs={STATS_SECTION_TABS}
        value={section}
        onChange={(value) => setSection(value as StatsSection)}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-p-line bg-white px-3 py-2.5">
        <div className="text-sm text-p-muted">
          {studentsLoading ? 'Загрузка данных...' : `В выборке ${students.length} студентов`}
        </div>
        <FilterPopover activeCount={activeFiltersCount} onReset={resetFilters}>
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Скоуп">
              <Select value={scope} onValueChange={(v) => setScope(v as ListScope)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="mine">Мои</SelectItem>
                  <SelectItem value="assigned">С ответственными</SelectItem>
                  <SelectItem value="unassigned">Без ответственного</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Статус pipeline">
              <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : (v as PipelineStatus))}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {PIPELINE_COLUMNS.map((status) => (
                    <SelectItem key={status} value={status}>{PIPELINE_STATUS_LABELS[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Год intake">
              <Select value={yearFilter || 'all'} onValueChange={(v) => setYearFilter(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все годы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все годы</SelectItem>
                  {directory.years.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Ступень">
              <Select value={degreeFilter || 'all'} onValueChange={(v) => setDegreeFilter(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все ступени" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все ступени</SelectItem>
                  {directory.degrees.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {DEGREE_LEVEL_LABELS[opt.value as keyof typeof DEGREE_LEVEL_LABELS] ?? opt.value} · {opt.count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>

          <FilterField label="Страна поступления">
            <Select value={countryFilter || 'all'} onValueChange={(v) => setCountryFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все страны" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все страны</SelectItem>
                {directory.countries.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          {directory.canFilterByResponsible && (
            <FilterField label="Ответственный (ментор/МЗК)">
              <ResponsiblePicker
                users={directory.responsibleUsers}
                value={responsibleIdFilter}
                onChange={setResponsibleIdFilter}
              />
            </FilterField>
          )}
        </FilterPopover>
      </div>

      {filterChips.length > 0 && (
        <div className="mb-8">
          <FilterChips chips={filterChips} onResetAll={resetFilters} />
        </div>
      )}

      {studentsFailed && (
        <QueryError colorPrefix="p" error={directory.error} onRetry={directory.refetch} className="mb-6" />
      )}

      {section === 'overview' && (
        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {studentsLoading ? (
            Array.from({ length: 7 }).map((_, idx) => (
              <div key={idx} className="h-[122px] animate-pulse rounded-card border border-p-line bg-p-panel" />
            ))
          ) : (
            <>
              <StatCard
                colorPrefix="p"
                label="Студенты"
                value={String(stats.students_total)}
                sub={`${stats.active_work} в активной работе`}
                icon={<Users className="h-4 w-4" />}
              />
              <StatCard
                colorPrefix="p"
                label="Без roadmap"
                value={String(stats.without_roadmap)}
                sub="студентов без назначенного плана"
                icon={<RouteIcon className="h-4 w-4" />}
                warn={stats.without_roadmap > 0}
              />
              <StatCard
                colorPrefix="p"
                label="Telegram-сигналы"
                value={String(stats.telegram_signals)}
                sub="ждут разбора по всем менторам"
                icon={<MessageCircle className="h-4 w-4" />}
                warn={stats.telegram_signals > 0}
              />
              <StatCard
                colorPrefix="p"
                label="Документы на проверку"
                value={String(stats.documents_unverified)}
                sub="требуют верификации"
                icon={<FileWarning className="h-4 w-4" />}
                warn={stats.documents_unverified > 0}
              />
              <StatCard
                colorPrefix="p"
                label="Открытых задач"
                value={String(stats.open_internal_tasks)}
                sub={`${stats.open_roadmap_tasks} задач в roadmap`}
                icon={<Bell className="h-4 w-4" />}
              />
              <StatCard
                colorPrefix="p"
                label="С ближайшей встречей"
                value={String(stats.with_next_meeting)}
                sub="студентов с next meeting"
                icon={<Sparkles className="h-4 w-4" />}
              />
              <StatCard
                colorPrefix="p"
                label="Без доступа в портал"
                value={String(stats.without_portal)}
                sub="нужна активация student portal"
                icon={<Users className="h-4 w-4" />}
                warn={stats.without_portal > 0}
              />
            </>
          )}
          <Link
            to="/finances"
            className="group flex min-w-0 flex-col justify-between rounded-card border border-dashed border-p-line bg-p-panel p-5 transition hover:-translate-y-0.5 hover:border-p-accent-dim"
          >
            <span className="label-caps text-p-muted">Финансы</span>
            <span className="mt-2.5 flex items-center gap-1 font-display text-lg font-black leading-none tracking-tight text-p-text">
              Договоры и платежи
              <ChevronRight className="h-5 w-5 flex-none text-brand transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="mt-2 text-xs text-p-muted">Суммы, остатки и сверка с Notion — на странице «Финансы»</span>
          </Link>
        </div>
      )}

      {section === 'funnel-risks' && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
            <span className="h-5 w-1 flex-none rounded bg-brand" />
            Воронка по статусам pipeline
          </h2>
          <div className="rounded-card border border-p-line p-5">
            {studentsLoading ? (
              <p className="text-sm text-p-muted">Загрузка…</p>
            ) : (
              <>
                <div className="space-y-3">
                  {funnel.map((row) => (
                    <div key={row.status} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 truncate text-sm text-p-text">{row.label}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-p-bg">
                        <div
                          className={`h-full rounded-full ${RISK_GROUP_BAR_CLASS[row.riskGroup]}`}
                          style={{ width: row.count === 0 ? '0%' : `${Math.max(2, (row.count / funnelMax) * 100)}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-base font-bold tabular-nums text-p-text">{row.count}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-p-line pt-3">
                  {(Object.keys(RISK_GROUP_LABELS) as RiskGroup[]).map((group) => (
                    <span key={group} className="inline-flex items-center gap-1.5 text-xs text-p-muted">
                      <span className={`h-2 w-2 rounded-full ${RISK_GROUP_BAR_CLASS[group]}`} />
                      {RISK_GROUP_LABELS[group]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {section === 'funnel-risks' && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
            <span className="h-5 w-1 flex-none rounded bg-brand" />
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Риск-лист
            <span className="rounded-full border border-p-line bg-p-panel px-2.5 py-0.5 text-2xs text-p-muted2">
              {riskList.length}
            </span>
          </h2>
          <p className="mb-3 text-xs text-p-muted">
            Студенты в статусах риска (на визе / подвешено / перевели / на возврате) и/или дольше 30 дней в текущей работе.
          </p>
          <div className="rounded-card border border-p-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Студент</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Страна</TableHead>
                  <TableHead>Ответственный</TableHead>
                  <TableHead className="text-right">Дней в работе</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {studentsLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-p-muted">Загрузка…</TableCell>
                  </TableRow>
                ) : riskList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-p-muted">Рисковых студентов нет</TableCell>
                  </TableRow>
                ) : riskList.map(({ student, status, pipelineRisk, bucket }) => (
                  <TableRow key={student.id}>
                    <TableCell>
                      <Link
                        to={`/students/${student.id}`}
                        className="font-medium text-p-text hover:text-brand hover:underline"
                      >
                        {student.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-pill px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${PIPELINE_STATUS_COLORS[status]}`}>
                        {PIPELINE_STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {pipelineRisk && (
                          <span className="rounded-pill bg-red-50 border border-red-200 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-red-700">
                            Риск-статус
                          </span>
                        )}
                        {bucket !== 'low' && (
                          <span className={`rounded-pill px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${AGING_BUCKET_STYLE[bucket]}`}>
                            {AGING_BUCKET_LABELS[bucket]}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-p-muted">{student.country || '—'}</TableCell>
                    <TableCell className="text-p-muted">{studentResponsibles(student)}</TableCell>
                    <TableCell className="text-right font-semibold">{student.days_in_work ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!studentsLoading && riskTotal > riskList.length && (
            <p className="mt-2 text-xs text-p-muted">
              Показаны {riskList.length} из {riskTotal} ·{' '}
              <Link to="/at-risk" className="font-medium underline hover:text-brand">
                Открыть полный риск-лист →
              </Link>
            </p>
          )}
        </section>
      )}

      {section === 'funnel-risks' && (
        <section className="mb-10 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-card border border-p-line p-5">
            <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
              <span className="h-5 w-1 flex-none rounded bg-brand" />
              Топ стран
            </h2>
            <div className="space-y-2">
              {countryTop.length === 0 ? (
                <p className="text-sm text-p-muted">Нет данных по странам</p>
              ) : countryTop.map(([country, count]) => (
                <div key={country} className="flex items-center gap-2">
                  <span className="w-44 truncate text-sm text-p-text">{country}</span>
                  <div className="h-2 flex-1 rounded-full bg-p-bg">
                    <div className="h-full rounded-full bg-sky-600" style={{ width: count === 0 ? '0%' : `${Math.max(3, (count / Math.max(countryTop[0]?.[1] || 1, 1)) * 100)}%` }} />
                  </div>
                  <span className="w-10 text-right text-base font-bold tabular-nums text-p-text">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-p-line p-5">
            <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
              <span className="h-5 w-1 flex-none rounded bg-brand" />
              Ступени
            </h2>
            <div className="space-y-2">
              {degreeStats.length === 0 ? (
                <p className="text-sm text-p-muted">Нет данных по ступеням</p>
              ) : degreeStats.map(([degree, count]) => (
                <div key={degree} className="flex items-center gap-2">
                  <span className="w-44 truncate text-sm text-p-text">
                    {DEGREE_LEVEL_LABELS[degree as keyof typeof DEGREE_LEVEL_LABELS] ?? degree}
                  </span>
                  <div className="h-2 flex-1 rounded-full bg-p-bg">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: count === 0 ? '0%' : `${Math.max(3, (count / Math.max(degreeStats[0]?.[1] || 1, 1)) * 100)}%` }} />
                  </div>
                  <span className="w-10 text-right text-base font-bold tabular-nums text-p-text">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {section === 'services' && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
            <span className="h-5 w-1 flex-none rounded bg-brand" />
            Услуги
            <span className="rounded-full border border-p-line bg-p-panel px-2.5 py-0.5 text-2xs text-p-muted2">
              {serviceStats.byType.length}
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-3">
            <div className="overflow-x-auto rounded-card border border-p-line">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Услуга</TableHead>
                    <TableHead className="text-right">Всего</TableHead>
                    <TableHead className="text-right">В процессе</TableHead>
                    <TableHead className="text-right">Запланировано</TableHead>
                    <TableHead className="text-right">Завершено</TableHead>
                    <TableHead className="text-right">Просрочено</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentsLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-p-muted">Загрузка…</TableCell>
                    </TableRow>
                  ) : serviceStats.byType.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-p-muted">Нет данных по услугам</TableCell>
                    </TableRow>
                  ) : serviceStats.byType.map(([type, data]) => (
                    <TableRow key={type}>
                      <TableCell className="font-medium text-p-text">{SERVICE_TYPE_LABELS[type]}</TableCell>
                      <TableCell className="text-right">{data.total}</TableCell>
                      <TableCell className="text-right">{data.in_progress}</TableCell>
                      <TableCell className="text-right">{data.scheduled}</TableCell>
                      <TableCell className="text-right text-emerald-700">{data.completed}</TableCell>
                      <TableCell className={`text-right ${data.overdue > 0 ? 'font-semibold text-red-600' : 'text-p-muted2'}`}>
                        {data.overdue}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-card border border-p-line p-5">
              <h3 className="mb-3 text-sm font-semibold text-p-text">
                Просроченные дедлайны {serviceStats.overdueTotal > 0 && `(${serviceStats.overdueTotal})`}
              </h3>
              {serviceStats.overdueItems.length === 0 ? (
                <p className="text-sm text-p-muted">Просроченных дедлайнов нет.</p>
              ) : (
                <div className="space-y-2">
                  {serviceStats.overdueItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 rounded-panel border border-p-line bg-p-bg px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-p-text">{item.student_name}</div>
                        <div className="text-[11px] text-p-muted">{SERVICE_TYPE_LABELS[item.service_type]}</div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-red-600">
                        {new Date(item.deadline).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {section === 'team' && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
            <span className="h-5 w-1 flex-none rounded bg-brand" />
            Нагрузка по менторам
            <span className="rounded-full border border-p-line bg-p-panel px-2.5 py-0.5 text-2xs text-p-muted2">
              {workload.length}
            </span>
          </h2>
          {scope !== 'all' && scope !== 'mine' && (
            <div className="mb-3 rounded-card border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Для workload используется workspace scope: {workspaceScope === 'mine' ? 'мои' : 'все'}.
            </div>
          )}
          <div className="rounded-card border border-p-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ментор</TableHead>
                  <TableHead>Роль</TableHead>
                  {WORKLOAD_COLUMNS.map((col) => {
                    const active = workloadSort.key === col.key
                    return (
                      <TableHead key={col.key} className="text-right">
                        <button
                          type="button"
                          onClick={() => toggleWorkloadSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-p-text"
                        >
                          {col.label}
                          {active && (workloadSort.dir === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                        </button>
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboardLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-p-muted">Загрузка…</TableCell>
                  </TableRow>
                ) : sortedWorkload.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-p-muted">Нет назначенных менторов</TableCell>
                  </TableRow>
                ) : (
                  sortedWorkload.map((row) => {
                    const overloaded = workloadAvgStudents > 0 && row.students_total > workloadAvgStudents * 1.5
                    return (
                      <TableRow key={row.mentor.id} className={overloaded ? 'bg-amber-50/60' : undefined}>
                        <TableCell className="font-medium text-p-text">
                          <span className="inline-flex items-center gap-1.5">
                            {row.mentor.name}
                            {overloaded && (
                              <span title="Перегружен относительно средней нагрузки">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-p-muted">{row.roles.join(', ')}</TableCell>
                        <TableCell className="text-right">{row.students_total}</TableCell>
                        <TableCell className="text-right">{row.open_tasks}</TableCell>
                        <TableCell className="text-right">
                          {row.overdue_tasks > 0 ? (
                            <span className="font-semibold text-red-600">{row.overdue_tasks}</span>
                          ) : (
                            <span className="text-p-muted2">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.sla_penalties_this_month > 0 ? (
                            <span className="inline-flex rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-700">
                              {row.sla_penalties_this_month}
                            </span>
                          ) : (
                            <span className="text-p-muted2">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{row.telegram_signals}</TableCell>
                        <TableCell className="text-right">{row.documents_unverified}</TableCell>
                        <TableCell className="text-right">{row.ai_drafts}</TableCell>
                        <TableCell className="text-right">
                          {row.health_warnings > 0 ? (
                            <span className="inline-flex rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              {row.health_warnings}
                            </span>
                          ) : (
                            <span className="text-p-muted2">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {section === 'team' && (
        <section>
          <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-black tracking-tight text-p-text">
            <span className="h-5 w-1 flex-none rounded bg-brand" />
            Операционные сигналы
          </h2>
          {dashboardLoading ? (
            <p className="text-sm text-p-muted">Загрузка signals…</p>
          ) : healthSignals.length === 0 ? (
            <div className="rounded-card border border-p-line p-5 text-sm text-p-muted">
              Критичных операционных сигналов нет.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {healthSignals.map((signal) => {
                const SEVERITY_STYLE: Record<string, string> = {
                  high: 'bg-red-50 text-red-700 border border-red-200',
                  medium: 'bg-orange-50 text-orange-700 border border-orange-200',
                  low: 'bg-gray-50 text-gray-600 border border-gray-200',
                }
                return (
                  <span
                    key={signal.kind}
                    className={`inline-flex items-center gap-2 rounded-ctl px-3 py-2 text-sm font-medium ${SEVERITY_STYLE[signal.severity] ?? SEVERITY_STYLE.low}`}
                  >
                    {signal.label}
                    <span className="font-black">{signal.count}</span>
                  </span>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
