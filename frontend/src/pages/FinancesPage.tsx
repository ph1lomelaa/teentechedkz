import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { paymentsApi } from '@/api/index'
import { documentsApi } from '@/api/documents'
import { notionApi } from '@/api/notion'
import {
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  FinanceBreakdown,
} from '@/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import type { NotionFinanceSummary } from '@/api/notion'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'

function StatBlock({
  label,
  value,
  fullValue,
  hint,
  tone = 'default',
  onClick,
}: {
  label: string
  value: string | number
  fullValue?: string
  hint: string
  tone?: 'default' | 'positive' | 'negative'
  onClick?: () => void
}) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-p-text'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 border border-p-line rounded-[2px] p-5 text-left w-full ${
        onClick ? 'cursor-pointer hover:bg-p-bg transition-colors' : ''
      }`}
    >
      <p className="label-caps mb-3">{label}</p>
      <p
        className={`max-w-full truncate font-black tracking-tight leading-none text-[clamp(1.4rem,2vw,2rem)] ${valueColor}`}
        title={fullValue}
      >
        {value}
      </p>
      <p className="text-xs text-p-muted mt-2">{hint}</p>
    </button>
  )
}

const moneyCurrency = 'KZT'
const toNumber = (value?: string) => Number.parseFloat(value ?? '0') || 0
const formatMoney = (value?: string | number | null, currency = moneyCurrency) =>
  formatCurrency(value ?? undefined, currency)
const formatCompactMoney = (value?: string | number | null, currency = moneyCurrency) => {
  if (value === undefined || value === null || value === '') return '—'
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value
  if (!Number.isFinite(numeric)) return '—'
  if (Math.abs(numeric) < 1_000_000) return formatMoney(numeric, currency)
  return `${new Intl.NumberFormat('ru-RU', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric)} ${currency}`
}

function NotionMoneyTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'positive' | 'negative'
}) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-p-text'
  return (
    <div className="bg-white px-3 py-2.5 min-w-0 text-left w-full">
      <p className="text-[10px] uppercase tracking-wide text-p-muted2 truncate">{label}</p>
      <p
        className={`text-sm font-semibold mt-0.5 truncate ${value ? valueColor : 'text-gray-300'}`}
        title={value ? formatMoney(value) : undefined}
      >
        {value ? formatCompactMoney(value) : '—'}
      </p>
    </div>
  )
}

type FinanceInsightSelection =
  | { source: 'crm'; section: 'summary' | 'contracts' | 'paid' | 'remaining' }
  | { source: 'notion'; section: 'clients' | 'mentors' | 'english' | 'up' | 'other' | 'statuses' }

function NotionFinanceSection({
  data,
  onSelect,
}: {
  data?: NotionFinanceSummary
  onSelect: (selection: FinanceInsightSelection) => void
}) {
  if (!data || data.records === 0) return null
  const t = data.totals

  const HIDDEN_STATUSES = new Set([
    'Работа окончена',
    'Активная работа',
    'На визе',
    'Передумали',
    'На возврате',
    'Пропал абитуриент',
    'Пересдача IELTS',
    'Перевели на другой продукт',
    'Подвешено',
    'Пауза',
  ])

  const groups: { title: string; tiles: { label: string; value: number; tone?: 'positive' | 'negative' }[] }[] = [
    {
      title: 'Клиенты',
      tiles: [
        { label: 'Client fee', value: t.client_fee },
        { label: 'Остаток клиентов', value: t.client_remaining, tone: 'negative' },
        { label: 'TOTAL (Company)', value: t.total_company, tone: 'positive' },
      ],
    },
    {
      title: 'Менторы',
      tiles: [
        { label: 'TOTAL', value: t.mentor_total },
        { label: 'Выплачено', value: t.mentor_paid, tone: 'positive' },
        { label: 'К выплате (TBP)', value: t.mentor_tbp, tone: 'negative' },
      ],
    },
    {
      title: 'Английский',
      tiles: [
        { label: 'Сумма', value: t.english_sum },
        { label: 'Выплачено', value: t.english_paid, tone: 'positive' },
        { label: 'К выплате (TBP)', value: t.english_tbp, tone: 'negative' },
      ],
    },
    {
      title: 'УП',
      tiles: [
        { label: 'Сумма', value: t.up_sum },
        { label: 'Выплачено', value: t.up_paid, tone: 'positive' },
        { label: 'К выплате (TBP)', value: t.up_tbp, tone: 'negative' },
      ],
    },
    {
      title: 'Прочее',
      tiles: [
        { label: 'Профориентация', value: t.proforientation_sum },
        { label: 'IELTS exam fee', value: t.ielts_exam_fee },
      ],
    },
  ]

  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <button
          type="button"
          onClick={() => onSelect({ source: 'notion', section: 'statuses' })}
          className="label-caps text-left hover:text-p-text transition-colors"
        >
          Из Notion · {data.records} клиентов
        </button>
        <p className="text-xs text-p-muted2">
          только просмотр
          {data.synced_at &&
            ` · синхронизировано ${new Date(data.synced_at).toLocaleString('ru-RU', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })}`}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {groups.map((group) => (
          <div key={group.title} className="border border-p-line rounded-[2px] overflow-hidden">
            <button
              type="button"
              onClick={() => onSelect({
                source: 'notion',
                section:
                  group.title === 'Клиенты'
                    ? 'clients'
                    : group.title === 'Менторы'
                      ? 'mentors'
                      : group.title === 'Английский'
                        ? 'english'
                        : group.title === 'УП'
                          ? 'up'
                          : 'other',
              })}
              className="text-[11px] font-semibold uppercase tracking-wide text-p-muted px-3 py-2 border-b border-p-line bg-p-bg flex items-center justify-between gap-2 text-left w-full hover:bg-p-panel transition-colors"
            >
              {group.title}
              <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />
            </button>
            <div className="divide-y divide-gray-100">
              {group.tiles.map((tile) => (
                <NotionMoneyTile key={tile.label} label={tile.label} value={tile.value} tone={tile.tone} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {data.by_status.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {data.by_status
            .filter((s) => !HIDDEN_STATUSES.has(s.status))
            .map((s) => (
              <button
                key={s.status}
                type="button"
                onClick={() => onSelect({ source: 'notion', section: 'statuses' })}
                className="text-[11px] px-2 py-0.5 rounded-[2px] border border-p-line bg-p-bg text-p-muted hover:bg-p-panel transition-colors"
              >
                {s.status} · {s.count}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function MoneyProgress({ paid, total, tbp }: { paid?: number | null; total?: number | null; tbp?: number | null }) {
  const totalNum = total || 0
  const paidNum = paid || 0
  const pct = totalNum > 0 ? Math.min(100, Math.round((paidNum / totalNum) * 100)) : 0
  if (!totalNum && !paidNum && !tbp) {
    return <span className="text-xs text-p-muted">—</span>
  }
  return (
    <div className="min-w-[130px]">
      <div className="flex justify-between text-[11px] text-p-muted mb-0.5">
        <span>{formatCompactMoney(paidNum)}</span>
        <span>{formatCompactMoney(totalNum)}</span>
      </div>
      <div className="h-1.5 w-full bg-p-bg rounded-full overflow-hidden border border-p-line">
        <div
          className={`h-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-transparent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!!tbp && tbp > 0 && (
        <div className="text-[11px] text-red-600 mt-0.5">К выплате: {formatCompactMoney(tbp)}</div>
      )}
    </div>
  )
}

const PORTFOLIO_STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начато',
  in_progress: 'В процессе',
  completed: 'Завершено',
}

const PORTFOLIO_STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

function PortfolioBadge({
  status,
  achievements,
  calls,
}: {
  status?: string | null
  achievements?: number | null
  calls?: number | null
}) {
  if (!status) return <span className="text-xs text-p-muted">—</span>
  return (
    <div>
      <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PORTFOLIO_STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
        {PORTFOLIO_STATUS_LABELS[status] || status}
      </span>
      <div className="text-[11px] text-p-muted mt-1">
        {achievements ?? 0} достиж. · {calls ?? 0} звонков
      </div>
    </div>
  )
}

type CalendarEvent = {
  key: string
  student_id?: string | null
  student_name?: string | null
  remaining: number
  currency?: string
  date: string
  source: 'crm' | 'notion'
  responsible_name?: string | null
  payment_status?: string | null
}

function CalendarGrid({
  events,
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
}: {
  events: CalendarEvent[]
  month: Date
  onMonthChange: (d: Date) => void
  selectedDate: string | null
  onSelectDate: (iso: string | null) => void
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const monthStart = useMemo(() => new Date(month.getFullYear(), month.getMonth(), 1), [month])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, { count: number; sum: number }>()
    for (const e of events) {
      if (!e.date) continue
      const iso = e.date.slice(0, 10)
      const cur = map.get(iso) || { count: 0, sum: 0 }
      cur.count += 1
      cur.sum += e.remaining || 0
      map.set(iso, cur)
    }
    return map
  }, [events])

  const days = useMemo(() => {
    const startDay = monthStart.getDay() || 7 // make Monday=1..Sunday=7
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
    const arr = [] as { day: number; iso: string; count: number; sum: number }[]
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), d)
      const iso = date.toISOString().slice(0, 10)
      const info = eventsByDay.get(iso)
      arr.push({ day: d, iso, count: info?.count || 0, sum: info?.sum || 0 })
    }
    return { startDay, arr }
  }, [monthStart, eventsByDay])

  const years = useMemo(() => {
    const y = new Date().getFullYear()
    const arr = []
    for (let i = y - 2; i <= y + 3; i++) arr.push(i)
    return arr
  }, [])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}
          className="h-6 w-6 flex items-center justify-center rounded border border-p-line text-p-muted hover:bg-p-bg"
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <div className="flex items-center gap-1 text-sm font-semibold">
          <span className="capitalize">{monthStart.toLocaleString('ru-RU', { month: 'long' })}</span>
          <select
            value={monthStart.getFullYear()}
            onChange={(e) => onMonthChange(new Date(Number(e.target.value), monthStart.getMonth(), 1))}
            className="border border-p-line rounded-[2px] bg-transparent text-sm px-1 py-0.5"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}
          className="h-6 w-6 flex items-center justify-center rounded border border-p-line text-p-muted hover:bg-p-bg"
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-p-muted2">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
          <div key={d} className="text-[10px] font-medium">{d}</div>
        ))}
        {Array.from({ length: days.startDay - 1 }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.arr.map((d) => {
          const isToday = d.iso === todayIso
          const isSelected = d.iso === selectedDate
          return (
            <button
              key={d.day}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : d.iso)}
              title={d.count > 0 ? `${d.count} платеж(ей) · ${formatMoney(d.sum)}` : undefined}
              className="p-0.5"
            >
              <div
                className={`inline-flex h-8 w-8 items-center justify-center rounded text-xs border transition-colors ${
                  isSelected
                    ? 'bg-p-text text-p-bg border-p-text'
                    : isToday
                      ? 'border-p-text'
                      : 'border-transparent hover:bg-p-bg'
                }`}
              >
                <div className="flex flex-col items-center">
                  <div className="text-[12px]">{d.day}</div>
                  {d.count > 0 && (
                    <div className={`h-1.5 w-1.5 rounded-full mt-0.5 ${isSelected ? 'bg-p-bg' : 'bg-rose-500'}`} />
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          const now = new Date()
          onMonthChange(new Date(now.getFullYear(), now.getMonth(), 1))
          onSelectDate(now.toISOString().slice(0, 10))
        }}
        className="mt-2 text-[11px] text-p-muted underline hover:text-p-text"
      >
        Сегодня
      </button>
    </div>
  )
}

export const FinancesPage: React.FC = () => {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['finance-summary'],
    queryFn: paymentsApi.financeSummary,
  })

  const { data: financeBreakdown } = useQuery<FinanceBreakdown>({
    queryKey: ['finance-breakdown'],
    queryFn: paymentsApi.financeBreakdown,
  })

  const { data: notionSummary } = useQuery({
    queryKey: ['notion', 'finance-summary'],
    queryFn: notionApi.financeSummary,
  })

  const { data: upcoming } = useQuery({
    queryKey: ['payments', 'upcoming'],
    queryFn: paymentsApi.upcoming,
    refetchInterval: 1000 * 60 * 5, // refresh every 5 minutes
  })

  const { data: mentorPayouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ['mentor-payouts'],
    queryFn: paymentsApi.mentorPayouts,
  })

  const { data: paymentsList = [] } = useQuery({
    queryKey: ['payments', 'list'],
    queryFn: () => paymentsApi.list(),
  })

  const [selectedInsight, setSelectedInsight] = React.useState<FinanceInsightSelection | null>(null)
  const [docsModalPayment, setDocsModalPayment] = React.useState<{ id: string; studentId: string } | null>(null)
  const [calendarMonth, setCalendarMonth] = React.useState(() => new Date())
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null)
  const [pictureSearch, setPictureSearch] = React.useState('')
  const [pictureStatus, setPictureStatus] = React.useState('all')
  const [picturePortfolio, setPicturePortfolio] = React.useState('all')
  const [pictureOnlyDebt, setPictureOnlyDebt] = React.useState(false)
  const [pictureSort, setPictureSort] = React.useState<
    'remaining_desc' | 'name_asc' | 'mentor_tbp_desc' | 'english_tbp_desc' | 'up_tbp_desc'
  >('remaining_desc')
  const docsQuery = useQuery({
    queryKey: ['payment-docs', docsModalPayment?.id],
    queryFn: () => (docsModalPayment ? paymentsApi.documentsForPayment(docsModalPayment.id) : []),
    enabled: !!docsModalPayment,
  })
  const queryClient = useQueryClient()
  const [uploading, setUploading] = React.useState(false)
  const uploadReceiptMutation = useMutation({
    mutationFn: (file: File) => {
      if (!docsModalPayment) throw new Error('Не выбран платёж')
      return documentsApi.upload(docsModalPayment.studentId, file, 'other', docsModalPayment.id)
    },
    onMutate: () => setUploading(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-docs', docsModalPayment?.id] })
    },
    onSettled: () => setUploading(false),
  })

  const selectedLabel =
    selectedInsight?.source === 'crm'
      ? selectedInsight.section === 'summary'
        ? 'CRM: сводка'
        : selectedInsight.section === 'contracts'
          ? 'CRM: договоры'
          : selectedInsight.section === 'paid'
            ? 'CRM: оплачено'
            : 'CRM: остатки'
      : selectedInsight?.section === 'clients'
        ? 'Notion: клиенты'
        : selectedInsight?.section === 'mentors'
          ? 'Notion: менторы'
          : selectedInsight?.section === 'english'
            ? 'Notion: английский'
            : selectedInsight?.section === 'up'
              ? 'Notion: УП'
              : selectedInsight?.section === 'other'
                ? 'Notion: прочее'
                : selectedInsight?.section === 'statuses'
                  ? 'Notion: статусы'
                  : ''

  const crmRows = financeBreakdown?.contracts ?? []
  const notionRows = React.useMemo(() => notionSummary?.rows ?? [], [notionSummary?.rows])

  const filteredPictureRows = React.useMemo(() => {
    const search = pictureSearch.trim().toLowerCase()
    let rows = notionRows.filter((r) => {
      if (search) {
        const haystack = [r.full_name, r.lead_mentor, ...(r.mentors || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      if (pictureStatus !== 'all' && r.payment_status !== pictureStatus) return false
      if (picturePortfolio !== 'all') {
        if (picturePortfolio === 'none' && r.portfolio_status) return false
        if (picturePortfolio !== 'none' && r.portfolio_status !== picturePortfolio) return false
      }
      if (pictureOnlyDebt) {
        const hasDebt = r.client_remaining > 0 || r.english_tbp > 0 || r.up_tbp > 0 || r.mentor_tbp > 0
        if (!hasDebt) return false
      }
      return true
    })
    rows = [...rows].sort((a, b) => {
      switch (pictureSort) {
        case 'name_asc':
          return (a.full_name ?? '').localeCompare(b.full_name ?? '')
        case 'mentor_tbp_desc':
          return (b.mentor_tbp || 0) - (a.mentor_tbp || 0)
        case 'english_tbp_desc':
          return (b.english_tbp || 0) - (a.english_tbp || 0)
        case 'up_tbp_desc':
          return (b.up_tbp || 0) - (a.up_tbp || 0)
        case 'remaining_desc':
        default:
          return (b.client_remaining || 0) - (a.client_remaining || 0)
      }
    })
    return rows
  }, [notionRows, pictureSearch, pictureStatus, picturePortfolio, pictureOnlyDebt, pictureSort])

  // «Живой» календарь платежей: CRM-остатки (введены вручную в договорах) +
  // остатки клиентов из Notion (реальный источник, если в CRM дата не заведена).
  // По одному студенту приоритет у CRM-записи — она точнее отражает актуальный статус.
  const calendarEvents = React.useMemo<CalendarEvent[]>(() => {
    const crmEvents: CalendarEvent[] = (upcoming || [])
      .filter((u: any) => u.client_remaining_date)
      .map((u: any) => ({
        key: `crm-${u.contract_id}`,
        student_id: u.student_id,
        student_name: u.student_name,
        remaining: Number(u.remaining) || 0,
        currency: u.currency,
        date: u.client_remaining_date,
        source: 'crm' as const,
        responsible_name: u.responsible_name,
      }))
    const notionEvents: CalendarEvent[] = notionRows
      .filter((r) => r.client_remaining_date && r.client_remaining > 0)
      .map((r) => ({
        key: `notion-${r.id}`,
        student_id: r.student_id ?? null,
        student_name: r.full_name,
        remaining: r.client_remaining,
        currency: 'KZT',
        date: r.client_remaining_date as string,
        source: 'notion' as const,
        payment_status: r.payment_status,
      }))

    const byStudent = new Map<string, CalendarEvent>()
    const noStudent: CalendarEvent[] = []
    for (const e of notionEvents) {
      if (e.student_id) byStudent.set(e.student_id, e)
      else noStudent.push(e)
    }
    for (const e of crmEvents) {
      // CRM данные считаем более точными — перекрывают Notion по тому же студенту
      if (e.student_id) byStudent.set(e.student_id, e)
      else noStudent.push(e)
    }
    return [...byStudent.values(), ...noStudent].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [upcoming, notionRows])

  const todayIso = React.useMemo(() => new Date().toISOString().slice(0, 10), [])
  const futureEvents = React.useMemo(
    () => calendarEvents.filter((e) => e.date && e.date.slice(0, 10) >= todayIso),
    [calendarEvents, todayIso],
  )
  const eventsInSelectedMonth = React.useMemo(
    () =>
      calendarEvents.filter(
        (e) =>
          e.date &&
          new Date(e.date).getFullYear() === calendarMonth.getFullYear() &&
          new Date(e.date).getMonth() === calendarMonth.getMonth(),
      ),
    [calendarEvents, calendarMonth],
  )
  const visibleEvents = React.useMemo(
    () => (selectedDate ? calendarEvents.filter((e) => e.date && e.date.slice(0, 10) === selectedDate) : eventsInSelectedMonth),
    [calendarEvents, selectedDate, eventsInSelectedMonth],
  )
  const overdueEvents = React.useMemo(
    () => calendarEvents.filter((e) => e.date && e.date.slice(0, 10) < todayIso && e.remaining > 0),
    [calendarEvents, todayIso],
  )


  const selectedNotionRows = React.useMemo(() => {
    if (!selectedInsight || selectedInsight.source !== 'notion') return []
    if (!notionRows.length) return []
    switch (selectedInsight.section) {
      case 'clients':
        return notionRows.map((row) => ({
          ...row,
          value_a: row.client_fee,
          value_b: row.client_remaining,
          value_c: row.total_company,
        }))
      case 'mentors':
        return notionRows.map((row) => ({
          ...row,
          value_a: row.mentor_total,
          value_b: row.mentor_paid,
          value_c: row.mentor_tbp,
        }))
      case 'english':
        return notionRows.map((row) => ({
          ...row,
          value_a: row.english_sum,
          value_b: row.english_paid,
          value_c: row.english_tbp,
        }))
      case 'up':
        return notionRows.map((row) => ({
          ...row,
          value_a: row.up_sum,
          value_b: row.up_paid,
          value_c: row.up_tbp,
        }))
      case 'other':
        return notionRows.map((row) => ({
          ...row,
          value_a: row.proforientation_sum,
          value_b: row.ielts_exam_fee,
        }))
      case 'statuses':
        return []
      default:
        return []
    }
  }, [notionRows, selectedInsight])

  const NOTION_SECTION_COLUMNS: Record<string, [string, string, string?]> = {
    clients: ['Client fee', 'Остаток клиента', 'Total (Company)'],
    mentors: ['Total (Mentors)', 'Выплачено', 'К выплате (TBP)'],
    english: ['Сумма', 'Выплачено', 'К выплате (TBP)'],
    up: ['Сумма', 'Выплачено', 'К выплате (TBP)'],
    other: ['Профориентация', 'IELTS exam fee'],
  }

  const selectedSummary = React.useMemo(() => {
    if (!selectedInsight || selectedInsight.source !== 'notion' || selectedInsight.section === 'statuses') return null
    const rows = selectedNotionRows as unknown as Array<{ value_a: number | null; value_b: number | null; value_c?: number | null }>
    if (!rows.length) return null
    const sumA = rows.reduce((s, r) => s + (r.value_a || 0), 0)
    const sumB = rows.reduce((s, r) => s + (r.value_b || 0), 0)
    const sumC = rows.reduce((s, r) => s + (r.value_c || 0), 0)
    const participants = rows.filter((r) => (r.value_a || 0) > 0 || (r.value_b || 0) > 0).length
    // «Долг» — для клиентов это остаток (value_b), для остальных блоков — TBP (value_c)
    const outstandingKey: 'value_b' | 'value_c' = selectedInsight.section === 'clients' ? 'value_b' : 'value_c'
    const outstandingSum = outstandingKey === 'value_b' ? sumB : sumC
    const outstandingCount = rows.filter((r) => (r[outstandingKey] || 0) > 0).length
    const paidPct = sumA > 0 && selectedInsight.section !== 'clients' && selectedInsight.section !== 'other'
      ? Math.round((sumB / sumA) * 100)
      : null
    return { sumA, sumB, sumC, participants, outstandingKey, outstandingSum, outstandingCount, paidPct }
  }, [selectedNotionRows, selectedInsight])

  return (
    <div className="mx-auto w-full">
      <CrmPageHeader eyebrow="CRM" title="Финансы" description={(
        <>
          Верхний блок — договоры и платежи, внесённые в CRM. Блок «Из Notion» — живое зеркало
          Notion-таблицы, обновляется автоматически раз в час и кнопкой «Синк Notion».
        </>
      )} />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <StatBlock
          label="Договоров"
          value={summaryLoading ? '…' : summary?.total_contracts ?? 0}
          hint="договоры в CRM"
          onClick={() => setSelectedInsight({ source: 'crm', section: 'contracts' })}
        />
        <StatBlock
          label="Общая сумма"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_amount, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_amount, summary?.currency ?? moneyCurrency)}
          hint="суммы договоров CRM"
          onClick={() => setSelectedInsight({ source: 'crm', section: 'summary' })}
        />
        <StatBlock
          label="Оплачено"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_paid, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_paid, summary?.currency ?? moneyCurrency)}
          hint="платежи, внесённые в CRM"
          tone="positive"
          onClick={() => setSelectedInsight({ source: 'crm', section: 'paid' })}
        />
        <StatBlock
          label="Остаток"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_remaining, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_remaining, summary?.currency ?? moneyCurrency)}
          hint="остатки из договоров CRM"
          tone="negative"
          onClick={() => setSelectedInsight({ source: 'crm', section: 'remaining' })}
        />
      </div>

      {/* Живые суммы из Notion-зеркала */}
      <NotionFinanceSection data={notionSummary} onSelect={setSelectedInsight} />

      {overdueEvents.length > 0 && (
        <div className="mb-6 border border-red-300 bg-red-50 rounded-[2px] p-4">
          <p className="label-caps text-red-700 mb-2">
            Просрочено · {overdueEvents.length} · {formatMoney(overdueEvents.reduce((sum, e) => sum + (e.remaining || 0), 0))}
          </p>
          <ul className="space-y-1.5 max-h-56 overflow-auto pr-1">
            {overdueEvents
              .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
              .map((u) => (
                <li key={`overdue-${u.key}`} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-p-text">
                      {u.student_id ? (
                        <Link to={`/students/${u.student_id}`} className="underline hover:text-p-text">
                          {u.student_name}
                        </Link>
                      ) : (
                        u.student_name || '—'
                      )}
                    </span>
                    <span className="text-xs text-p-muted ml-2">
                      {u.source === 'crm' ? (u.responsible_name || 'CRM') : 'Notion'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-red-700">{formatMoney(u.remaining, u.currency)}</span>
                    <span className="text-xs text-p-muted ml-2">
                      просрочено с {u.date ? new Date(u.date).toLocaleDateString('ru-RU') : '—'}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Students with remaining balances */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="label-caps">Календарь ближайших платежей</p>
          <p className="text-xs text-p-muted2">
            Источники: CRM-договоры + Notion «Остаток клиента» · {calendarEvents.length} записей с датой
          </p>
        </div>
        <div className="border border-p-line rounded-[2px] p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-1">
              <CalendarGrid
                events={calendarEvents}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
              <div className="mt-4 pt-3 border-t border-p-line text-xs text-p-muted space-y-1">
                <div>Всего с датой: {calendarEvents.length}</div>
                <div>Ожидают оплаты (сегодня и позже): {futureEvents.length}</div>
                <div>Сумма к получению: {formatMoney(calendarEvents.reduce((sum, e) => sum + (e.remaining || 0), 0))}</div>
              </div>
            </div>
            <div className="sm:col-span-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-p-muted uppercase tracking-wide">
                  {selectedDate
                    ? `Платежи на ${new Date(selectedDate).toLocaleDateString('ru-RU')}`
                    : `Платежи за ${calendarMonth.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}`}
                </p>
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="text-[11px] text-p-muted underline hover:text-p-text"
                  >
                    Сбросить
                  </button>
                )}
              </div>
              {visibleEvents.length > 0 ? (
                <ul className="space-y-2 max-h-96 overflow-auto pr-1">
                  {visibleEvents.map((u) => (
                    <li key={u.key} className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-p-text">
                          {u.student_id ? (
                            <Link to={`/students/${u.student_id}`} className="underline hover:text-p-text">
                              {u.student_name}
                            </Link>
                          ) : (
                            u.student_name || '—'
                          )}
                        </div>
                        <div className="text-xs text-p-muted">
                          {u.source === 'crm' ? (u.responsible_name || 'CRM') : `Notion${u.payment_status ? ` · ${u.payment_status}` : ''}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-p-text">{formatMoney(u.remaining, u.currency)}</div>
                        <div className="text-xs text-p-muted">{u.date ? new Date(u.date).toLocaleDateString('ru-RU') : '—'}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : futureEvents.length === 0 && notionSummary && notionSummary.rows && notionSummary.rows.length > 0 ? (
                (() => {
                  const top = notionSummary.rows
                    .filter((r) => r.client_remaining && r.client_remaining > 0)
                    .sort((a, b) => b.client_remaining - a.client_remaining)
                    .slice(0, 5)
                  return top.length > 0 ? (
                    <div>
                      <p className="text-p-muted mb-2">
                        На сегодня платежей с датой нет — топ неплательщиков (Notion, {notionSummary.records} клиентов):
                      </p>
                      <ul className="text-xs text-p-muted space-y-1">
                        {top.map((r) => (
                          <li key={r.id}>{r.full_name ?? '—'} — {formatMoney(r.client_remaining)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-p-muted">Нет платежей за этот период</p>
                  )
                })()
              ) : (
                <p className="text-p-muted">Нет платежей за этот период</p>
              )}
            </div>
          </div>
        </div>

      </div>
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <p className="label-caps">Полная финансовая картина (Notion) — по каждому клиенту</p>
          <p className="text-xs text-p-muted2">
            Английский / УП / Менторы / Портфолио · {filteredPictureRows.length} из {notionRows.length} клиентов
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="text"
            value={pictureSearch}
            onChange={(e) => setPictureSearch(e.target.value)}
            placeholder="Поиск по студенту или ментору…"
            className="border border-p-line rounded-[2px] bg-transparent text-sm px-2 py-1 w-48"
          />
          <select
            value={pictureStatus}
            onChange={(e) => setPictureStatus(e.target.value)}
            className="border border-p-line rounded-[2px] bg-transparent text-sm px-2 py-1"
          >
            <option value="all">Все статусы</option>
            {(notionSummary?.by_status ?? []).map((s) => (
              <option key={s.status} value={s.status}>{s.status} ({s.count})</option>
            ))}
          </select>
          <select
            value={picturePortfolio}
            onChange={(e) => setPicturePortfolio(e.target.value)}
            className="border border-p-line rounded-[2px] bg-transparent text-sm px-2 py-1"
          >
            <option value="all">Портфолио: все</option>
            <option value="none">Без данных</option>
            <option value="not_started">Не начато</option>
            <option value="in_progress">В процессе</option>
            <option value="completed">Завершено</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-p-muted cursor-pointer">
            <input
              type="checkbox"
              checked={pictureOnlyDebt}
              onChange={(e) => setPictureOnlyDebt(e.target.checked)}
            />
            Только с долгом
          </label>
          <select
            value={pictureSort}
            onChange={(e) => setPictureSort(e.target.value as typeof pictureSort)}
            className="border border-p-line rounded-[2px] bg-transparent text-sm px-2 py-1 ml-auto"
          >
            <option value="remaining_desc">Сортировка: остаток клиента ↓</option>
            <option value="mentor_tbp_desc">Сортировка: долг менторам ↓</option>
            <option value="english_tbp_desc">Сортировка: долг (англ.) ↓</option>
            <option value="up_tbp_desc">Сортировка: долг (УП) ↓</option>
            <option value="name_asc">Сортировка: имя А→Я</option>
          </select>
          {(pictureSearch || pictureStatus !== 'all' || picturePortfolio !== 'all' || pictureOnlyDebt) && (
            <button
              type="button"
              onClick={() => {
                setPictureSearch('')
                setPictureStatus('all')
                setPicturePortfolio('all')
                setPictureOnlyDebt(false)
              }}
              className="text-xs text-p-muted underline hover:text-p-text"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
        <div className="border-y border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Студент</TableHead>
                <TableHead>Ментор</TableHead>
                <TableHead>Статус (Notion)</TableHead>
                <TableHead>Остаток клиента</TableHead>
                <TableHead>Английский</TableHead>
                <TableHead>УП</TableHead>
                <TableHead>Менторы (TBP)</TableHead>
                <TableHead>Проф. / IELTS</TableHead>
                <TableHead>Портфолио</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPictureRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-p-muted">
                    {notionRows.length === 0 ? 'Нет данных Notion' : 'Ничего не найдено по фильтрам'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredPictureRows.map((r) => (
                    <TableRow key={r.id} className="border-border hover:bg-muted/50 align-top">
                      <TableCell className="font-medium text-p-text whitespace-nowrap">
                        {r.student_id ? (
                          <Link to={`/students/${r.student_id}`} className="hover:underline">{r.full_name ?? '—'}</Link>
                        ) : (
                          r.full_name ?? '—'
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-p-muted whitespace-nowrap">
                        {r.lead_mentor || (r.mentors && r.mentors.length > 0 ? r.mentors.join(', ') : '—')}
                        {r.mzk && <div className="text-[10px] text-p-muted2">МЗК: {r.mzk}</div>}
                      </TableCell>
                      <TableCell className="text-p-muted text-xs whitespace-nowrap">{r.payment_status}</TableCell>
                      <TableCell className={`font-medium whitespace-nowrap ${r.client_remaining > 0 ? 'text-red-600' : 'text-p-muted'}`}>
                        {r.client_remaining_filled === false && r.client_remaining === 0 ? (
                          <span title="В Notion ячейка «Остаток клиента» пустая — это не то же самое, что подтверждённый 0">
                            нет данных
                          </span>
                        ) : (
                          formatMoney(r.client_remaining)
                        )}
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <MoneyProgress paid={r.english_paid} total={r.english_sum} tbp={r.english_tbp} />
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <MoneyProgress paid={r.up_paid} total={r.up_sum} tbp={r.up_tbp} />
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <MoneyProgress paid={r.mentor_paid} total={r.mentor_total} tbp={r.mentor_tbp} />
                      </TableCell>
                      <TableCell className="text-xs text-p-muted whitespace-nowrap">
                        <div>Проф: {formatMoney(r.proforientation_sum)}</div>
                        <div>IELTS: {formatMoney(r.ielts_exam_fee)}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <PortfolioBadge status={r.portfolio_status} achievements={r.portfolio_achievements} calls={r.portfolio_calls} />
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="mb-10">
        <p className="label-caps mb-3">История платежей (последние)</p>
        <div className="border border-p-line rounded-[2px] p-4">
          {(!paymentsList || paymentsList.length === 0) ? (
            <p className="text-p-muted">Платежей пока нет</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Студент</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Чеки</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentsList.slice(0, 50).map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.paid_at ? new Date(p.paid_at).toLocaleString('ru-RU') : p.due_date ? new Date(p.due_date).toLocaleDateString('ru-RU') : '—'}</TableCell>
                      <TableCell><Link to={`/students/${p.student_id}`}>{p.student_name}</Link></TableCell>
                      <TableCell>{formatMoney(p.amount, p.currency)}</TableCell>
                      <TableCell>{p.status}</TableCell>
                      <TableCell className="text-right">
                        <button onClick={() => setDocsModalPayment({ id: p.id, studentId: p.student_id })} className="text-xs text-p-muted underline">Показать</button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Mentor payouts */}
      <div>
        <p className="label-caps mb-3">Выплаты менторам</p>
        <div className="border-y border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Ментор</TableHead>
                <TableHead>Начислено</TableHead>
                <TableHead>Выплачено</TableHead>
                <TableHead>Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payoutsLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-p-muted">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : mentorPayouts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-p-muted">
                    В CRM платежи менторам не вносились — фактические выплаты смотри
                    в блоке «Из Notion» выше (TOTAL / Выплачено / TBP)
                  </TableCell>
                </TableRow>
              ) : (
                mentorPayouts.map((payout) => (
                  <TableRow key={payout.mentor_id} className="border-border hover:bg-muted/50">
                    <TableCell className="font-medium text-p-text">{payout.mentor_name}</TableCell>
                    <TableCell className="text-p-muted">
                      {formatCurrency(toNumber(payout.paid) + toNumber(payout.to_be_paid), payout.currency ?? moneyCurrency)}
                    </TableCell>
                    <TableCell className="text-emerald-700">
                      {formatCurrency(payout.paid, payout.currency ?? moneyCurrency)}
                    </TableCell>
                    <TableCell className={toNumber(payout.to_be_paid) > 0 ? 'text-red-600 font-medium' : 'text-p-muted'}>
                      {formatCurrency(payout.to_be_paid, payout.currency ?? moneyCurrency)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!selectedInsight} onOpenChange={(open) => !open && setSelectedInsight(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{selectedLabel}</DialogTitle>
            <DialogDescription>
              Ниже показаны исходные строки, из которых собирается цифра на карточке. Если поле
              «Остаток CRM» не равно «Остаток по формуле», это уже расхождение данных.
            </DialogDescription>
          </DialogHeader>

          {selectedInsight?.source === 'crm' ? (
            <div className="max-h-[70vh] overflow-auto border border-p-line rounded-[2px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-p-line hover:bg-transparent">
                    <TableHead>Студент</TableHead>
                    <TableHead>Ответственный</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Договор</TableHead>
                    <TableHead>Оплачено</TableHead>
                    <TableHead>Остаток CRM</TableHead>
                    <TableHead>Остаток по формуле</TableHead>
                    <TableHead>Проверка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crmRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-p-muted">
                        Нет данных для разбора
                      </TableCell>
                    </TableRow>
                  ) : (
                    crmRows.map((row) => {
                      const remaining = toNumber(row.remaining_amount)
                      const calculatedRemaining = toNumber(row.calculated_remaining_amount)
                      const diff = Math.abs(remaining - calculatedRemaining)
                      const mismatch = diff > 0.01
                      return (
                        <TableRow key={row.contract_id} className="border-p-line">
                          <TableCell className="font-medium text-p-text">
                            <Link to={`/students/${row.student_id}`} className="hover:underline">
                              {row.student_name}
                            </Link>
                            <div className="text-[11px] text-p-muted2">
                              {row.degree_level} · {row.intake_year}
                            </div>
                          </TableCell>
                          <TableCell className="text-p-muted">
                            {row.responsible_name ?? row.manager_name ?? row.mentor_name ?? '—'}
                            <div className="text-[11px] text-p-muted2">
                              {row.responsible_role === 'manager'
                                ? 'менеджер'
                                : row.responsible_role === 'mentor'
                                  ? 'ментор'
                                  : '—'}
                            </div>
                          </TableCell>
                          <TableCell>
                            {row.pipeline_status ? (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[row.pipeline_status]}`}
                              >
                                {PIPELINE_STATUS_LABELS[row.pipeline_status] ?? row.pipeline_status}
                              </span>
                            ) : (
                              <span className="text-p-muted text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-p-muted">
                            {formatMoney(row.amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-emerald-700">
                            {formatMoney(row.paid_amount, row.currency)}
                          </TableCell>
                          <TableCell className="font-medium text-red-600">
                            {formatMoney(row.remaining_amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-p-muted">
                            {formatMoney(row.calculated_remaining_amount, row.currency)}
                          </TableCell>
                          <TableCell className={mismatch ? 'text-red-600 font-medium' : 'text-emerald-700'}>
                            {mismatch ? `Расхождение ${formatMoney(diff, row.currency)}` : 'Сходится'}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          ) : selectedInsight?.source === 'notion' ? (
            selectedInsight.section === 'statuses' ? (
              <div className="flex flex-wrap gap-2">
                {notionSummary?.by_status.map((status) => (
                  <div key={status.status} className="px-3 py-2 border border-p-line rounded-[2px]">
                    <div className="text-[11px] uppercase tracking-wide text-p-muted2">{status.status}</div>
                    <div className="text-lg font-semibold text-p-text">{status.count}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {selectedSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="border border-p-line rounded-[2px] p-2">
                      <div className="text-[10px] uppercase tracking-wide text-p-muted2">
                        {NOTION_SECTION_COLUMNS[selectedInsight.section]?.[0] ?? 'Сумма'}
                      </div>
                      <div className="text-sm font-semibold text-p-text">{formatMoney(selectedSummary.sumA)}</div>
                    </div>
                    <div className="border border-p-line rounded-[2px] p-2">
                      <div className="text-[10px] uppercase tracking-wide text-p-muted2">
                        {NOTION_SECTION_COLUMNS[selectedInsight.section]?.[1] ?? 'Выплачено'}
                      </div>
                      <div className="text-sm font-semibold text-emerald-700">{formatMoney(selectedSummary.sumB)}</div>
                    </div>
                    <div className="border border-p-line rounded-[2px] p-2">
                      <div className="text-[10px] uppercase tracking-wide text-p-muted2">
                        {selectedInsight.section === 'clients' ? 'Долг клиентов' : 'Долг (TBP)'}
                      </div>
                      <div className="text-sm font-semibold text-red-600">{formatMoney(selectedSummary.outstandingSum)}</div>
                    </div>
                    <div className="border border-p-line rounded-[2px] p-2">
                      <div className="text-[10px] uppercase tracking-wide text-p-muted2">Участников / должников</div>
                      <div className="text-sm font-semibold text-p-text">
                        {selectedSummary.participants} / {selectedSummary.outstandingCount}
                        {selectedSummary.paidPct !== null && (
                          <span className="text-p-muted font-normal"> · {selectedSummary.paidPct}% выплачено</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="max-h-[60vh] overflow-auto border border-p-line rounded-[2px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-p-line hover:bg-transparent">
                        <TableHead>Клиент</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>{NOTION_SECTION_COLUMNS[selectedInsight.section]?.[0] ?? 'Сумма 1'}</TableHead>
                        <TableHead>{NOTION_SECTION_COLUMNS[selectedInsight.section]?.[1] ?? 'Сумма 2'}</TableHead>
                        {NOTION_SECTION_COLUMNS[selectedInsight.section]?.[2] && (
                          <TableHead>{NOTION_SECTION_COLUMNS[selectedInsight.section]?.[2]}</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedNotionRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-p-muted">
                            Нет данных для разбора
                          </TableCell>
                        </TableRow>
                      ) : (
                        [...selectedNotionRows]
                          .sort((a: any, b: any) => {
                            const key = selectedSummary?.outstandingKey ?? 'value_c'
                            return (b[key] || 0) - (a[key] || 0)
                          })
                          .map((row: any) => {
                            const values = [row.value_a, row.value_b, row.value_c]
                            return (
                              <TableRow key={row.id} className="border-p-line">
                                <TableCell className="font-medium text-p-text">
                                  {row.full_name ?? '—'}
                                  <div className="text-[11px] text-p-muted2">{row.intake ?? '—'}</div>
                                </TableCell>
                                <TableCell className="text-p-muted">{row.payment_status}</TableCell>
                                <TableCell className="text-p-muted">{formatMoney(values[0])}</TableCell>
                                <TableCell className="text-p-muted">{formatMoney(values[1])}</TableCell>
                                {NOTION_SECTION_COLUMNS[selectedInsight.section]?.[2] && (
                                  <TableCell className={(values[2] || 0) > 0 ? 'text-red-600 font-medium' : 'text-p-muted'}>
                                    {values[2] === null || values[2] === undefined ? '—' : formatMoney(values[2])}
                                  </TableCell>
                                )}
                              </TableRow>
                            )
                          })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!docsModalPayment} onOpenChange={(open) => { if (!open) setDocsModalPayment(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Чеки и документы</DialogTitle>
            <DialogDescription>Файлы, прикреплённые к платежу</DialogDescription>
          </DialogHeader>
          <div className="mt-3">
            {docsQuery.isLoading ? (
              <p className="text-p-muted">Загрузка...</p>
            ) : (docsQuery.data || []).length === 0 ? (
              <p className="text-p-muted">Чеков не найдено</p>
            ) : (
              <ul className="space-y-2">
                {(docsQuery.data || []).map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-p-text">{d.file_name}</div>
                      <div className="text-xs text-p-muted">{d.mime_type} · {new Date(d.uploaded_at).toLocaleString('ru-RU')}</div>
                    </div>
                    <div className="text-right">
                      <a className="text-xs underline" href={`/api/v1/documents/${d.id}/download`}>Скачать</a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-p-line">
            <label className="text-xs text-p-muted underline cursor-pointer hover:text-p-text">
              {uploading ? 'Загрузка...' : '+ Загрузить чек'}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadReceiptMutation.mutate(file)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
