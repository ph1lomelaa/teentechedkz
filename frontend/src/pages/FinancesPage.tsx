import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/api/index'
import { notionApi } from '@/api/notion'
import {
  DEGREE_LEVEL_LABELS,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
} from '@/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

function StatBlock({
  label,
  value,
  fullValue,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  fullValue?: string
  hint: string
  tone?: 'default' | 'positive' | 'negative'
}) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-gray-900'
  return (
    <div className="min-w-0 border border-gray-200 rounded-[2px] p-5">
      <p className="label-caps mb-3">{label}</p>
      <p
        className={`max-w-full truncate font-black tracking-tight leading-none text-[clamp(1.4rem,2vw,2rem)] ${valueColor}`}
        title={fullValue}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-2">{hint}</p>
    </div>
  )
}

const moneyCurrency = 'KZT'
const toNumber = (value?: string) => Number.parseFloat(value ?? '0') || 0
const formatMoney = (value?: string | number, currency = moneyCurrency) =>
  formatCurrency(value, currency)
const formatCompactMoney = (value?: string | number, currency = moneyCurrency) => {
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
    <div className="bg-white px-3 py-2.5 min-w-0">
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

function NotionFinanceSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['notion', 'finance-summary'],
    queryFn: notionApi.financeSummary,
  })

  if (isLoading || !data || data.records === 0) return null
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
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="label-caps">Из Notion · {data.records} клиентов</p>
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-3 py-2 border-b border-gray-200 bg-gray-50">
              {group.title}
            </p>
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
            <span
              key={s.status}
              className="text-[11px] px-2 py-0.5 rounded-[2px] border border-gray-200 bg-gray-50 text-gray-600"
            >
              {s.status} · {s.count}
            </span>
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

  const { data: mentorPayouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ['mentor-payouts'],
    queryFn: paymentsApi.mentorPayouts,
  })

  const { data: studentsWithBalance = [], isLoading: balancesLoading } = useQuery({
    queryKey: ['client-balances'],
    queryFn: paymentsApi.clientBalances,
  })

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
        />
        <StatBlock
          label="Общая сумма"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_amount, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_amount, summary?.currency ?? moneyCurrency)}
          hint="суммы договоров CRM"
        />
        <StatBlock
          label="Оплачено"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_paid, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_paid, summary?.currency ?? moneyCurrency)}
          hint="платежи, внесённые в CRM"
          tone="positive"
        />
        <StatBlock
          label="Остаток"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_remaining, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_remaining, summary?.currency ?? moneyCurrency)}
          hint="остатки из договоров CRM"
          tone="negative"
        />
      </div>

      {/* Живые суммы из Notion-зеркала */}
      <NotionFinanceSection />

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
                <TableHead>Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balancesLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : studentsWithBalance.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-gray-500">
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
    </div>
  )
}
