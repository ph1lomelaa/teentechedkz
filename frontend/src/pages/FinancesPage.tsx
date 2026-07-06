import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { paymentsApi } from '@/api/index'
import { notionApi } from '@/api/notion'
import {
  DEGREE_LEVEL_LABELS,
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
        : 'text-gray-900'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 border border-gray-200 rounded-[2px] p-5 text-left w-full ${
        onClick ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''
      }`}
    >
      <p className="label-caps mb-3">{label}</p>
      <p
        className={`max-w-full truncate font-black tracking-tight leading-none text-[clamp(1.4rem,2vw,2rem)] ${valueColor}`}
        title={fullValue}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-2">{hint}</p>
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
        : 'text-gray-900'
  return (
    <div className="bg-white px-3 py-2.5 min-w-0 text-left w-full">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{label}</p>
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
          className="label-caps text-left hover:text-gray-700 transition-colors"
        >
          Из Notion · {data.records} клиентов
        </button>
        <p className="text-xs text-gray-400">
          только просмотр
          {data.synced_at &&
            ` · синхронизировано ${new Date(data.synced_at).toLocaleString('ru-RU', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })}`}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {groups.map((group) => (
          <div key={group.title} className="border border-gray-200 rounded-[2px] overflow-hidden">
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
              className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2 text-left w-full hover:bg-gray-100 transition-colors"
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
          {data.by_status.map((s) => (
            <button
              key={s.status}
              type="button"
              onClick={() => onSelect({ source: 'notion', section: 'statuses' })}
              className="text-[11px] px-2 py-0.5 rounded-[2px] border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {s.status} · {s.count}
            </button>
          ))}
        </div>
      )}
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

  const { data: mentorPayouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ['mentor-payouts'],
    queryFn: paymentsApi.mentorPayouts,
  })

  const { data: studentsWithBalance = [], isLoading: balancesLoading } = useQuery({
    queryKey: ['client-balances'],
    queryFn: paymentsApi.clientBalances,
  })

  const [selectedInsight, setSelectedInsight] = React.useState<FinanceInsightSelection | null>(null)

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
  const notionRows = notionSummary?.rows ?? []

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

  return (
    <div>
      <div className="mb-6 pb-5 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Финансы</h1>
        <p className="text-xs text-gray-500 mt-1.5">
          Верхний блок — договоры и платежи, внесённые в CRM. Блок «Из Notion» — живое зеркало
          Notion-таблицы, обновляется автоматически раз в час и кнопкой «Синк Notion».
        </p>
      </div>

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

      {/* Students with remaining balances */}
      <div className="mb-10">
        <p className="label-caps mb-3">Остатки по клиентам</p>
        <div className="border-y border-gray-200">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 hover:bg-transparent">
                <TableHead>Студент</TableHead>
                <TableHead>Год</TableHead>
                <TableHead>Степень</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead>Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balancesLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : studentsWithBalance.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    Нет клиентов с остатком
                  </TableCell>
                </TableRow>
              ) : (
                studentsWithBalance.map((student) => (
                  <TableRow key={student.student_id} className="border-gray-100 hover:bg-gray-50">
                    <TableCell className="font-medium text-gray-900">
                      <Link to={`/students/${student.student_id}`} className="hover:underline">
                        {student.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-gray-600">{student.intake_year}</TableCell>
                    <TableCell className="text-gray-600">
                      {DEGREE_LEVEL_LABELS[student.degree_level] ?? student.degree_level}
                    </TableCell>
                    <TableCell>
                      {student.pipeline_status ? (
                        <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                          {PIPELINE_STATUS_LABELS[student.pipeline_status] ?? student.pipeline_status}
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {student.responsible_name ? (
                        <div>
                          <div className="font-medium text-gray-900">{student.responsible_name}</div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">
                            {student.responsible_role === 'manager'
                              ? 'менеджер'
                              : student.responsible_role === 'mentor'
                                ? 'ментор'
                                : '—'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-red-600">
                      {formatMoney(student.remaining, student.currency)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Mentor payouts */}
      <div>
        <p className="label-caps mb-3">Выплаты менторам</p>
        <div className="border-y border-gray-200">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 hover:bg-transparent">
                <TableHead>Ментор</TableHead>
                <TableHead>Начислено</TableHead>
                <TableHead>Выплачено</TableHead>
                <TableHead>Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payoutsLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : mentorPayouts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                    В CRM платежи менторам не вносились — фактические выплаты смотри
                    в блоке «Из Notion» выше (TOTAL / Выплачено / TBP)
                  </TableCell>
                </TableRow>
              ) : (
                mentorPayouts.map((payout) => (
                  <TableRow key={payout.mentor_id} className="border-gray-100 hover:bg-gray-50">
                    <TableCell className="font-medium text-gray-900">{payout.mentor_name}</TableCell>
                    <TableCell className="text-gray-600">
                      {formatCurrency(toNumber(payout.paid) + toNumber(payout.to_be_paid), payout.currency ?? moneyCurrency)}
                    </TableCell>
                    <TableCell className="text-emerald-700">
                      {formatCurrency(payout.paid, payout.currency ?? moneyCurrency)}
                    </TableCell>
                    <TableCell className={toNumber(payout.to_be_paid) > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
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
            <div className="max-h-[70vh] overflow-auto border border-gray-200 rounded-[2px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200 hover:bg-transparent">
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
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
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
                        <TableRow key={row.contract_id} className="border-gray-100">
                          <TableCell className="font-medium text-gray-900">
                            <Link to={`/students/${row.student_id}`} className="hover:underline">
                              {row.student_name}
                            </Link>
                            <div className="text-[11px] text-gray-400">
                              {row.degree_level} · {row.intake_year}
                            </div>
                          </TableCell>
                          <TableCell className="text-gray-600">
                            {row.responsible_name ?? row.manager_name ?? row.mentor_name ?? '—'}
                            <div className="text-[11px] text-gray-400">
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
                              <span className="text-gray-500 text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-gray-600">
                            {formatMoney(row.amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-emerald-700">
                            {formatMoney(row.paid_amount, row.currency)}
                          </TableCell>
                          <TableCell className="font-medium text-red-600">
                            {formatMoney(row.remaining_amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-gray-600">
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
                  <div key={status.status} className="px-3 py-2 border border-gray-200 rounded-[2px]">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">{status.status}</div>
                    <div className="text-lg font-semibold text-gray-900">{status.count}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto border border-gray-200 rounded-[2px]">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 hover:bg-transparent">
                      <TableHead>Клиент</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Сумма 1</TableHead>
                      <TableHead>Сумма 2</TableHead>
                      <TableHead>Сумма 3</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedNotionRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                          Нет данных для разбора
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedNotionRows.map((row) => {
                        const values =
                          selectedInsight.section === 'clients'
                            ? [row.client_fee, row.client_remaining, row.total_company]
                            : selectedInsight.section === 'mentors'
                              ? [row.mentor_total, row.mentor_paid, row.mentor_tbp]
                              : selectedInsight.section === 'english'
                                ? [row.english_sum, row.english_paid, row.english_tbp]
                                : selectedInsight.section === 'up'
                                  ? [row.up_sum, row.up_paid, row.up_tbp]
                                  : [row.proforientation_sum, row.ielts_exam_fee, null]
                        return (
                          <TableRow key={row.id} className="border-gray-100">
                            <TableCell className="font-medium text-gray-900">
                              {row.full_name ?? '—'}
                              <div className="text-[11px] text-gray-400">{row.intake ?? '—'}</div>
                            </TableCell>
                            <TableCell className="text-gray-600">{row.payment_status}</TableCell>
                            <TableCell className="text-gray-600">{formatMoney(values[0])}</TableCell>
                            <TableCell className="text-gray-600">{formatMoney(values[1])}</TableCell>
                            <TableCell className="text-gray-600">
                              {values[2] === null ? '—' : formatMoney(values[2])}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
