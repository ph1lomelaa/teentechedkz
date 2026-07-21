import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, Route as RouteIcon, Bell, FileWarning, Sparkles, MessageCircle } from 'lucide-react'
import { paymentsApi } from '@/api/index'
import { studentsApi } from '@/api/students'
import { workspaceApi } from '@/api/workspace'
import { PIPELINE_COLUMNS, PIPELINE_STATUS_LABELS } from '@/types'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
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
  medium: 'bg-amber-50 text-amber-700 border border-amber-200',
  low: 'bg-gray-50 text-gray-600 border border-gray-200',
}

export function StatisticsPage() {
  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['statistics', 'workspace-dashboard'],
    queryFn: () => workspaceApi.dashboard({ scope: 'all' }),
  })
  const { data: finance, isLoading: financeLoading } = useQuery({
    queryKey: ['statistics', 'finance-summary'],
    queryFn: () => paymentsApi.financeSummary(),
  })
  const { data: facets, isLoading: facetsLoading } = useQuery({
    queryKey: ['statistics', 'student-facets'],
    queryFn: () => studentsApi.facets(),
  })

  const stats = dashboard?.stats
  const workload = dashboard?.workload ?? []
  const healthSignals = dashboard?.health_signals ?? []

  const statusCounts = new Map((facets?.statuses ?? []).map((item) => [item.value, item.count]))
  const funnel = PIPELINE_COLUMNS.map((status) => ({
    status,
    label: PIPELINE_STATUS_LABELS[status],
    count: statusCounts.get(status) ?? 0,
  }))
  const funnelMax = Math.max(1, ...funnel.map((row) => row.count))

  return (
    <div>
      <CrmPageHeader
        eyebrow="CRM"
        title="Статистика"
        description="Сводка по всей организации: студенты, нагрузка по менторам, финансы и точки внимания. Обновляется вместе с рабочими данными."
      />

      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Студенты"
          value={stats?.students_total ?? 0}
          hint={`${stats?.active_work ?? 0} в активной работе`}
          icon={<Users className="h-4 w-4" />}
          loading={dashboardLoading}
        />
        <StatTile
          label="Без roadmap"
          value={stats?.without_roadmap ?? 0}
          hint="студентов без назначенного плана"
          icon={<RouteIcon className="h-4 w-4" />}
          loading={dashboardLoading}
        />
        <StatTile
          label="Telegram-сигналы"
          value={stats?.telegram_signals ?? 0}
          hint="ждут разбора по всем менторам"
          icon={<MessageCircle className="h-4 w-4" />}
          loading={dashboardLoading}
        />
        <StatTile
          label="Документы на проверку"
          value={stats?.documents_unverified ?? 0}
          hint={`из ${stats?.documents_total ?? 0} всего`}
          icon={<FileWarning className="h-4 w-4" />}
          loading={dashboardLoading}
        />
        <StatTile
          label="Открытых задач"
          value={stats?.open_internal_tasks ?? 0}
          hint={`${stats?.open_roadmap_tasks ?? 0} задач в roadmap`}
          icon={<Bell className="h-4 w-4" />}
          loading={dashboardLoading}
        />
        <StatTile
          label="AI-черновики"
          value={stats?.ai_drafts ?? 0}
          hint="конспектов ждут проверки"
          icon={<Sparkles className="h-4 w-4" />}
          loading={dashboardLoading}
        />
        <StatTile
          label="Договоров"
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
          Воронка по статусам договора
        </h2>
        <div className="rounded-[2px] border border-p-line p-5">
          {facetsLoading ? (
            <p className="text-sm text-p-muted">Загрузка…</p>
          ) : (
            <div className="space-y-3">
              {funnel.map((row) => (
                <div key={row.status} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-sm text-p-text">{row.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-p-bg">
                    <div
                      className="h-full rounded-full bg-brand"
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

      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-black tracking-tight text-p-text">
          Нагрузка по менторам
        </h2>
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
                <TableHead className="text-right">Сигналов</TableHead>
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
          На что обратить внимание
        </h2>
        {dashboardLoading ? (
          <p className="text-sm text-p-muted">Загрузка…</p>
        ) : healthSignals.length === 0 ? (
          <div className="rounded-[2px] border border-p-line p-5 text-sm text-p-muted">
            Критичных сигналов по организации нет.
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
