/**
 * Таблица «Договоры» финансиста в стиле «Договоров и актов» (как в Notion):
 * строка — договор, фильтры по статусу, году, МЗК, графику, документу.
 */
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { financeApi, financeKeys, type FinanceContractRow } from '@/api/finance'
import { DEGREE_LEVEL_LABELS, type DegreeLevel } from '@/types'
import { ContractDocument } from './ContractDocument'
import { NotionTable } from './NotionTable'
import { FinBadge } from './ui'
import { date, money, num, statusLabel } from './format'

const NEXT_LABEL = { overdue: 'Просрочен', today: 'Сегодня', planned: 'По графику', paid_full: 'Оплачен полностью', not_planned: 'Графика нет' } as const
const QUERY = { status: 'all', size: 2000 } as const

function NextPayment({ row }: { row: FinanceContractRow }) {
  const { kind, item } = row.next_payment
  if (kind === 'overdue') return <FinBadge tone="bad">Просрочен{item ? ` · ${date(item.due_date)}` : ''}</FinBadge>
  if (kind === 'today') return <FinBadge tone="yellow">Сегодня</FinBadge>
  if (kind === 'paid_full') return <FinBadge tone="ok">Оплачен полностью</FinBadge>
  if (kind === 'not_planned') return <FinBadge tone="dashed">Графика нет</FinBadge>
  return <span className="whitespace-nowrap">{date(item?.due_date)} · {money(item?.left, row.currency)}</span>
}

function Paid({ row }: { row: FinanceContractRow }) {
  const total = num(row.amount)
  const pct = total > 0 ? Math.min(100, Math.round((num(row.paid) / total) * 100)) : 0
  return (
    <div className="flex min-w-36 items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-p-panel2" aria-hidden="true"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
      <span className="tabular-nums">{money(row.paid, row.currency)}</span>
    </div>
  )
}

const values = (row: FinanceContractRow, field: string): string[] => {
  if (field === 'Статус') return row.pipeline_status ? [statusLabel(row.pipeline_status)] : []
  if (field === 'Intake') return row.intake_year ? [String(row.intake_year)] : []
  if (field === 'Degree') return row.degree ? [DEGREE_LEVEL_LABELS[row.degree as DegreeLevel] ?? row.degree] : []
  if (field === 'МЗК') return row.mzk_name ? [row.mzk_name] : []
  if (field === 'Сумма') return row.amount == null ? [] : [String(num(row.amount))]
  if (field === 'Оплачено') return [String(num(row.paid))]
  if (field === 'Остаток') return row.remaining == null ? [] : [String(num(row.remaining))]
  if (field === 'Следующий платёж') return [NEXT_LABEL[row.next_payment.kind]]
  if (field === 'Срок оплаты') return row.next_payment.item ? [row.next_payment.item.due_date] : []
  if (field === 'График') return [row.next_payment.kind === 'not_planned' ? 'Графика нет' : row.schedule_mismatch ? 'Не совпадает с остатком' : 'Совпадает']
  if (field === 'Договор') return (row.originals ?? []).map(d => d.label)
  return []
}

export function ContractsTable() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: financeKeys.contracts(QUERY),
    queryFn: () => financeApi.contracts(QUERY),
    placeholderData: keepPreviousData,
  })
  // Старые ссылки: ?schedule=none (плашка Notion) и ?documents=no_contract.
  const initialQuick = [
    params.get('schedule') === 'none' && 'no_schedule',
    params.get('schedule') === 'mismatch' && 'mismatch',
    params.get('documents') === 'no_contract' && 'no_document',
  ].filter(Boolean) as string[]

  return (
    <NotionTable<FinanceContractRow>
      rows={data?.items}
      loading={isPending}
      error={error}
      onRetry={() => refetch()}
      rowKey={r => r.contract_id}
      title={{ field: 'Ученик', text: r => r.student_name, onOpen: r => navigate(`/finance/contracts/${r.contract_id}`) }}
      base={['МЗК', 'Сумма', 'Оплачено', 'Остаток', 'Следующий платёж', 'Договор']}
      extra={['Статус', 'Intake', 'Degree', 'Срок оплаты', 'График']}
      numeric={['Сумма', 'Оплачено', 'Остаток', 'Intake']}
      dates={['Срок оплаты']}
      values={values}
      cell={(row, field) => {
        if (field === 'Сумма') return money(row.amount, row.currency)
        if (field === 'Оплачено') return <Paid row={row} />
        if (field === 'Остаток') return <span className="font-semibold">{money(row.remaining, row.currency)}</span>
        if (field === 'Следующий платёж') return <NextPayment row={row} />
        if (field === 'Срок оплаты') return row.next_payment.item ? date(row.next_payment.item.due_date) : undefined
        if (field === 'График' && row.schedule_mismatch) return <FinBadge tone="yellow">Не совпадает с остатком</FinBadge>
        if (field === 'Договор') return <ContractDocument studentId={row.student_id} contractId={row.contract_id} documents={row.originals} />
        return undefined
      }}
      quick={[
        { key: 'overdue', label: 'Просрочен', test: r => r.next_payment.kind === 'overdue' },
        { key: 'no_schedule', label: 'Графика нет', test: r => r.next_payment.kind === 'not_planned' },
        { key: 'mismatch', label: 'Остаток не совпадает с графиком', test: r => !!r.schedule_mismatch },
        { key: 'no_document', label: 'Договор не загружен', test: r => !(r.originals ?? []).length },
      ]}
      initialQuick={initialQuick}
      groupFields={['Статус', 'Intake', 'Degree', 'МЗК', 'Следующий платёж', 'График']}
      defaultGroup="Статус"
      searchText={r => [r.student_name, r.mzk_name ?? '', ...(r.originals ?? []).map(d => d.label)]}
      initialSearch={params.get('q') ?? ''}
      storageKey="finance-contracts-fields"
      countLabel="Договоров"
      exportName="договоры"
      exportValue={(r, f) => f === 'Сумма' ? money(r.amount, r.currency) : f === 'Оплачено' ? money(r.paid, r.currency)
        : f === 'Остаток' ? money(r.remaining, r.currency) : f === 'Срок оплаты' ? date(r.next_payment.item?.due_date) : values(r, f).join(', ')}
      empty="По выбранным условиям договоров нет."
    />
  )
}
