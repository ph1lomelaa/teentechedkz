import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/api/index'
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
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <StatBlock
          label="Договоров"
          value={summaryLoading ? '…' : summary?.total_contracts ?? 0}
          hint="активных контрактов"
        />
        <StatBlock
          label="Общая сумма"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_amount, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_amount, summary?.currency ?? moneyCurrency)}
          hint="по всем договорам"
        />
        <StatBlock
          label="Оплачено"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_paid, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_paid, summary?.currency ?? moneyCurrency)}
          hint="получено всего"
          tone="positive"
        />
        <StatBlock
          label="Остаток"
          value={summaryLoading ? '…' : formatCompactMoney(summary?.total_remaining, summary?.currency ?? moneyCurrency)}
          fullValue={formatMoney(summary?.total_remaining, summary?.currency ?? moneyCurrency)}
          hint="к получению"
          tone="negative"
        />
      </div>

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
                    <TableCell className="font-medium text-gray-900">{student.full_name}</TableCell>
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
                    Нет данных о выплатах
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
