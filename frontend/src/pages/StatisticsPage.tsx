import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, FileWarning, MessageCircle, Route as RouteIcon, Sparkles, Users } from 'lucide-react'
import { paymentsApi } from '@/api/index'
import { studentsApi } from '@/api/students'
import { workspaceApi } from '@/api/workspace'
import { DEGREE_LEVEL_LABELS, PIPELINE_COLUMNS, PIPELINE_STATUS_COLORS, PIPELINE_STATUS_LABELS, PipelineStatus, StudentListItem } from '@/types'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
import { FilterChips, FilterField, FilterPopover, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory } from '@/hooks/useStudentDirectory'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

function StatTile({
  label,
  value,
  hint,
  icon,
  loading,
}: {
  label: string
  value: string | number
  hint?: string
  icon: React.ReactNode
  loading?: boolean
}) {
  return (
    <div className="min-w-0 rounded-[2px] border border-p-line p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="label-caps">{label}</p>
        <span className="text-p-muted2">{icon}</span>
      </div>
      <p className="truncate font-black leading-none tracking-tight text-[clamp(1.4rem,2vw,2rem)] text-p-text">
        {loading ? '…' : value}
      </p>
      {hint && <p className="mt-2 text-xs text-p-muted">{hint}</p>}
    </div>
  )
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'bg-red-50 text-red-700 border border-red-200',
  medium: 'bg-orange-50 text-orange-700 border border-orange-200',
  low: 'bg-gray-50 text-gray-600 border border-gray-200',
}

type ListScope = 'all' | 'mine' | 'assigned' | 'unassigned'

function pipelineOf(student: StudentListItem): PipelineStatus {
  return (student.pipeline_status || 'no_status') as PipelineStatus
}

function studentResponsibles(student: StudentListItem): string {
  const names = (student.mentors ?? []).slice(0, 2)
  if (names.length > 0) return names.join(', ')
  const fallback = (student.responsibles ?? []).filter((r) => r.is_active && r.name).map((r) => r.name as string)
  return fallback.slice(0, 2).join(', ') || 'Не назначен'
}

export function StatisticsPage() {
  const [scope, setScope] = useState<ListScope>('all')
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | ''>('')
  const [yearFilter, setYearFilter] = useState('')
  const [degreeFilter, setDegreeFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [responsibleIdFilter, setResponsibleIdFilter] = useState('')

  const directory = useStudentDirectory()
  const workspaceScope = scope === 'mine' ? 'mine' : 'all'

  const { data: studentsPage, isLoading: studentsLoading } = useQuery({
    queryKey: ['statistics', 'students', scope, statusFilter, yearFilter, degreeFilter, countryFilter],
    queryFn: () => studentsApi.list({
      size: 2000,
      scope,
      pipeline_status: statusFilter || undefined,
      intake_year: yearFilter ? Number(yearFilter) : undefined,
      degree_level: degreeFilter || undefined,
      country: countryFilter || undefined,
    }),
  })

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['statistics', 'workspace-dashboard', workspaceScope],
    queryFn: () => workspaceApi.dashboard({ scope: workspaceScope }),
  })
  const { data: finance, isLoading: financeLoading } = useQuery({
    queryKey: ['statistics', 'finance-summary'],
    queryFn: () => paymentsApi.financeSummary(),
  })
  const { data: financeBreakdown, isLoading: financeBreakdownLoading } = useQuery({
    queryKey: ['statistics', 'finance-breakdown'],
    queryFn: () => paymentsApi.financeBreakdown(),
  })
  const { data: facets } = useQuery({
    queryKey: ['statistics', 'student-facets'],
    queryFn: () => studentsApi.facets(),
  })

  const students = useMemo(() => {
    const rows = studentsPage?.items ?? []
    if (!responsibleIdFilter) return rows
    return rows.filter((student) =>
      (student.responsibles ?? []).some((responsible) => responsible.id === responsibleIdFilter && responsible.is_active),
    )
  }, [studentsPage?.items, responsibleIdFilter])

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
    })), [statusCounts])

  const funnelMax = Math.max(1, ...funnel.map((row) => row.count))
  const watchlist = useMemo(
    () => students
      .filter((student) => ['on_visa', 'suspended', 'transferred_pipeline'].includes(pipelineOf(student)))
      .sort((a, b) => (b.days_in_work ?? 0) - (a.days_in_work ?? 0)),
    [students],
  )
  const topAging = useMemo(
    () => [...students]
      .sort((a, b) => (b.days_in_work ?? 0) - (a.days_in_work ?? 0))
      .slice(0, 12),
    [students],
  )
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

  const workload = dashboard?.workload ?? []
  const healthSignals = dashboard?.health_signals ?? []

  const stats = useMemo(() => {
    const total = students.length
    const active = statusCounts.get('active_work') ?? 0
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
      active_work: active,
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

  const breakdownByStatus = useMemo(() => {
    const map = new Map<string, { amount: number; remaining: number }>()
    ;(financeBreakdown?.contracts ?? []).forEach((contract) => {
      const key = contract.pipeline_status || 'no_status'
      const current = map.get(key) || { amount: 0, remaining: 0 }
      current.amount += Number(contract.amount || 0)
      current.remaining += Number(contract.remaining_amount || 0)
      map.set(key, current)
    })
    return [...map.entries()].sort((a, b) => b[1].remaining - a[1].remaining).slice(0, 8)
  }, [financeBreakdown?.contracts])

  return (
    <div>
      <CrmPageHeader
        eyebrow="CRM"
        title="Статистика"
        description="Фильтруемая сводка по студентам, рискам, нагрузке и финансам. Цифры ниже меняются по выбранному срезу."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-p-line bg-white px-3 py-2.5">
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
                  {(facets?.years ?? []).map((opt) => (
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
                  {(facets?.degrees ?? []).map((opt) => (
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
                {(facets?.countries ?? []).map((opt) => (
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

      <div className="mb-8">
        <FilterChips chips={filterChips} onResetAll={resetFilters} />
      </div>

      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Студенты"
          value={stats.students_total}
          hint={`${stats.active_work} в активной работе`}
          icon={<Users className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="Без roadmap"
          value={stats.without_roadmap}
          hint="студентов без назначенного плана"
          icon={<RouteIcon className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="Telegram-сигналы"
          value={stats.telegram_signals}
          hint="ждут разбора по всем менторам"
          icon={<MessageCircle className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="Документы на проверку"
          value={stats.documents_unverified}
          hint="требуют верификации"
          icon={<FileWarning className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="Открытых задач"
          value={stats.open_internal_tasks}
          hint={`${stats.open_roadmap_tasks} задач в roadmap`}
          icon={<Bell className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="С ближайшей встречей"
          value={stats.with_next_meeting}
          hint="студентов с next meeting"
          icon={<Sparkles className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="Без доступа в портал"
          value={stats.without_portal}
          hint="нужна активация student portal"
          icon={<Users className="h-4 w-4" />}
          loading={studentsLoading}
        />
        <StatTile
          label="Договоров (общий CRM)"
          value={finance?.total_contracts ?? 0}
          hint="всего в CRM"
          icon={<Users className="h-4 w-4" />}
          loading={financeLoading}
        />
        <StatTile
          label="Остаток к оплате"
          value={formatCurrency(finance?.total_remaining, finance?.currency || 'KZT')}
          hint={`из ${formatCurrency(finance?.total_amount, finance?.currency || 'KZT')}`}
          icon={<Users className="h-4 w-4" />}
          loading={financeLoading}
        />
      </div>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">
          Воронка по статусам pipeline
        </h2>
        <div className="rounded-[2px] border border-p-line p-5">
          {studentsLoading ? (
            <p className="text-sm text-p-muted">Загрузка…</p>
          ) : (
            <div className="space-y-3">
              {funnel.map((row) => (
                <div key={row.status} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-sm text-p-text">{row.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-p-bg">
                    <div
                      className="h-full rounded-full bg-slate-600"
                      style={{ width: `${Math.max(2, (row.count / funnelMax) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-sm font-bold text-p-text">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mb-10 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-[2px] border border-p-line p-5">
          <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">Риск watchlist</h2>
          {studentsLoading ? (
            <p className="text-sm text-p-muted">Загрузка…</p>
          ) : watchlist.length === 0 ? (
            <p className="text-sm text-p-muted">Нет студентов в статусах На визе / Подвешено / Перевели.</p>
          ) : (
            <div className="space-y-2.5">
              {watchlist.slice(0, 8).map((student) => {
                const status = pipelineOf(student)
                return (
                  <div key={student.id} className="flex items-center justify-between gap-3 rounded-[2px] border border-p-line bg-p-bg px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-p-text">{student.full_name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-p-muted">{student.country || 'Страна не указана'} · {studentResponsibles(student)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-[2px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PIPELINE_STATUS_COLORS[status]}`}>
                        {PIPELINE_STATUS_LABELS[status]}
                      </span>
                      <span className="text-xs font-bold text-p-muted">{student.days_in_work ?? 0} дн</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-[2px] border border-p-line p-5">
          <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">Срез по странам и ступеням</h2>
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-p-muted">Топ стран</p>
            <div className="space-y-2">
              {countryTop.length === 0 ? (
                <p className="text-sm text-p-muted">Нет данных по странам</p>
              ) : countryTop.map(([country, count]) => (
                <div key={country} className="flex items-center gap-2">
                  <span className="w-40 truncate text-sm text-p-text">{country}</span>
                  <div className="h-2 flex-1 rounded-full bg-p-bg">
                    <div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.max(3, (count / Math.max(countryTop[0]?.[1] || 1, 1)) * 100)}%` }} />
                  </div>
                  <span className="w-10 text-right text-sm font-semibold text-p-text">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-p-muted">Ступени</p>
            <div className="flex flex-wrap gap-2">
              {degreeStats.map(([degree, count]) => (
                <span key={degree} className="inline-flex items-center gap-2 rounded-[2px] border border-p-line bg-white px-2.5 py-1.5 text-xs text-p-text">
                  {DEGREE_LEVEL_LABELS[degree as keyof typeof DEGREE_LEVEL_LABELS] ?? degree}
                  <span className="font-black">{count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">Дольше всего в работе</h2>
        <div className="rounded-[2px] border border-p-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Студент</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Страна</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead className="text-right">Дней в работе</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-p-muted">Загрузка…</TableCell>
                </TableRow>
              ) : topAging.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-p-muted">Нет данных</TableCell>
                </TableRow>
              ) : topAging.map((student) => {
                const status = pipelineOf(student)
                return (
                  <TableRow key={student.id}>
                    <TableCell className="font-medium text-p-text">{student.full_name}</TableCell>
                    <TableCell>
                      <span className={`rounded-[2px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PIPELINE_STATUS_COLORS[status]}`}>
                        {PIPELINE_STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-p-muted">{student.country || '—'}</TableCell>
                    <TableCell className="text-p-muted">{studentResponsibles(student)}</TableCell>
                    <TableCell className="text-right font-semibold">{student.days_in_work ?? 0}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">
          Нагрузка по менторам
        </h2>
        {scope !== 'all' && scope !== 'mine' && (
          <div className="mb-3 rounded-[2px] border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Для workload используется workspace scope: {workspaceScope === 'mine' ? 'мои' : 'все'}.
          </div>
        )}
        <div className="rounded-[2px] border border-p-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ментор</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead className="text-right">Студентов</TableHead>
                <TableHead className="text-right">Задач</TableHead>
                <TableHead className="text-right">Telegram</TableHead>
                <TableHead className="text-right">Документы</TableHead>
                <TableHead className="text-right">AI-черновики</TableHead>
                <TableHead className="text-right">Сигналы</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboardLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-p-muted">Загрузка…</TableCell>
                </TableRow>
              ) : workload.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-p-muted">Нет назначенных менторов</TableCell>
                </TableRow>
              ) : (
                workload.map((row) => (
                  <TableRow key={row.mentor.id}>
                    <TableCell className="font-medium text-p-text">{row.mentor.name}</TableCell>
                    <TableCell className="text-p-muted">{row.roles.join(', ')}</TableCell>
                    <TableCell className="text-right">{row.students_total}</TableCell>
                    <TableCell className="text-right">{row.open_tasks}</TableCell>
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">
          Финансы и точки внимания
        </h2>
        <div className="mb-4 rounded-[2px] border border-p-line p-4">
          <h3 className="mb-2 text-sm font-semibold text-p-text">Остаток по статусам договоров</h3>
          {financeBreakdownLoading ? (
            <p className="text-sm text-p-muted">Загрузка…</p>
          ) : breakdownByStatus.length === 0 ? (
            <p className="text-sm text-p-muted">Нет данных по договорам</p>
          ) : (
            <div className="space-y-2">
              {breakdownByStatus.map(([status, data]) => (
                <div key={status} className="flex items-center justify-between gap-2 rounded-[2px] border border-p-line bg-p-bg px-3 py-2 text-sm">
                  <span className="text-p-text">{PIPELINE_STATUS_LABELS[(status as PipelineStatus)] || status}</span>
                  <span className="font-semibold text-p-text">{formatCurrency(data.remaining, 'KZT')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {dashboardLoading ? (
          <p className="text-sm text-p-muted">Загрузка signals…</p>
        ) : healthSignals.length === 0 ? (
          <div className="rounded-[2px] border border-p-line p-5 text-sm text-p-muted">
            Критичных операционных сигналов нет.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {healthSignals.map((signal) => (
              <span
                key={signal.kind}
                className={`inline-flex items-center gap-2 rounded-[2px] px-3 py-2 text-sm font-medium ${SEVERITY_STYLE[signal.severity] ?? SEVERITY_STYLE.low}`}
              >
                {signal.label}
                <span className="font-black">{signal.count}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
