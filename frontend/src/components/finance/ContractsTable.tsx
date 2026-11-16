/**
 * Таблица «Договоры» финансиста в стиле «Договоров и актов» (как в Notion):
 * строка — договор, фильтры по статусу, году, МЗК, графику, документу.
 */
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { financeApi, financeKeys, type FinanceContractRow } from '@/api/finance'
import { DEGREE_LEVEL_LABELS, type DegreeLevel } from '@/types'
import { NotionTable } from './NotionTable'
import { FinBadge } from './ui'
import { date, money, moneyTotals, num, statusLabel } from './format'

const NEXT_LABEL = { overdue: 'Просрочен', today: 'Сегодня', planned: 'По графику', paid_full: 'Оплачен полностью', not_planned: 'Графика нет', after_offer: 'После оффера' } as const
const QUERY = { status: 'all', size: 2000 } as const
// Работа по договору окончена: такие договоры — в «Закрытых», не в «Активных».
const CLOSED = new Set(['completed_admitted', 'changed_mind', 'lost_applicant', 'refund', 'transferred_pipeline'])
const closed = (r: FinanceContractRow) => !!r.pipeline_status && CLOSED.has(r.pipeline_status)
const owes = (r: FinanceContractRow) => num(r.remaining) > 0
/** «Договор №671» → «671»: номер виден в таблице и ищется. */
/** В TrustMe у копий договоров номер бывает «UPL-UPL-…-№262»: показываем «UPL-№262». */
export const cleanNumber = (n: string) => n.replace(/^(UPL-)+/i, 'UPL-')
const numberOf = (r: FinanceContractRow) => r.number || (r.originals ?? []).map(d => d.label.match(/№\s*(.+)$/)?.[1]).filter((n): n is string => !!n).map(cleanNumber).join(', ')
// Ближайший платёж первым; без даты — в конце.
const nextKey = (r: FinanceContractRow) => r.next_payment.item?.due_date ?? '9999-12-31'

function NextPayment({ row }: { row: FinanceContractRow }) {
  const { kind, item } = row.next_payment
  if (kind === 'overdue') return <span className="whitespace-nowrap text-[var(--fin-bad)]">{date(item?.due_date)} · {money(item?.left, row.currency)}</span>
  if (kind === 'paid_full') return <FinBadge tone="ok">Оплачен полностью</FinBadge>
  if (kind === 'not_planned') return <span className="text-p-muted2">—</span>
  if (kind === 'after_offer') return <span className="whitespace-nowrap">После оффера · {money(item?.left, row.currency)}</span>
  return <span className="whitespace-nowrap">{date(item?.due_date)} · {money(item?.left, row.currency)}</span>
}

const values = (row: FinanceContractRow, field: string): string[] => {
  if (field === '№ договора') { const n = numberOf(row); return n ? [n] : [] }
  if (field === 'Статус') return row.pipeline_status ? [statusLabel(row.pipeline_status)] : []
  if (field === 'Набор') return row.intake_year ? [String(row.intake_year)] : []
  if (field === 'Степень') return row.degree ? [DEGREE_LEVEL_LABELS[row.degree as DegreeLevel] ?? row.degree] : []
  if (field === 'МЗК') return row.mzk_name ? [row.mzk_name] : []
  if (field === 'Сумма') return row.amount == null ? [] : [String(num(row.amount))]
  if (field === 'Оплачено') return [String(num(row.paid))]
  if (field === 'Остаток') return row.remaining == null ? [] : [String(num(row.remaining))]
  if (field === 'Следующий платёж') return [nextKey(row)]
  if (field === 'График') return [row.next_payment.kind === 'not_planned' ? 'Графика нет' : row.schedule_mismatch ? 'Не совпадает с остатком' : 'Есть']
  if (field === 'Документ') return (row.originals ?? []).length ? ['Есть'] : ['Нет документа']
  if (field === 'Акты') return !row.services_total ? ['Услуг в договоре нет'] : (row.services_closed ?? 0) < row.services_total ? ['Нет акта'] : ['Все акты есть']
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
  // По умолчанию «Активные»; поиск из шапки ищет по всем; ?schedule=none — договоры без графика (ссылка из «Проверки»).
  const initialQuick = [params.get('quick') || (params.get('q') ? 'all' : params.get('schedule') === 'none' ? 'no_schedule' : 'active')]
  const sum = (rows: FinanceContractRow[], pick: (r: FinanceContractRow) => string | null) =>
    moneyTotals(rows.map(r => ({ amount: pick(r) ?? '0', currency: r.currency })), 'amount')

  return (
    <NotionTable<FinanceContractRow>
      rows={data?.items}
      loading={isPending}
      error={error}
      onRetry={() => refetch()}
      rowKey={r => r.contract_id}
      title={{ field: 'Ученик', text: r => r.student_name, onOpen: r => navigate(`/finance/contracts/${r.contract_id}`), notion: r => r.notion_url }}
      base={['№ договора', 'МЗК', 'Сумма', 'Оплачено', 'Остаток', 'Следующий платёж', 'Статус']}
      extra={['Набор', 'Степень', 'График', 'Документ', 'Акты']}
      numeric={['Сумма', 'Оплачено', 'Остаток', 'Набор']}
      dates={['Следующий платёж']}
      values={values}
      cell={(row, field) => {
        if (field === '№ договора') { const n = numberOf(row); return n ? <span className="block max-w-[200px] truncate" title={n}>{n}</span> : undefined }
        if (field === 'Сумма') return money(row.amount, row.currency)
        if (field === 'Оплачено') return money(row.paid, row.currency)
        if (field === 'Остаток') return (
          <span className="inline-flex flex-col items-end">
            <span className="font-semibold">{money(row.remaining, row.currency)}</span>
            {row.by_payments != null && <span className="text-xs text-p-muted">по оплатам {money(row.by_payments, row.currency)}</span>}
          </span>
        )
        if (field === 'Следующий платёж') return <NextPayment row={row} />
        return undefined
      }}
      exclusiveQuick
      quick={[
        { key: 'active', label: 'Активные', test: r => !closed(r) && owes(r) },
        { key: 'overdue', label: 'С просрочкой', test: r => r.next_payment.kind === 'overdue' },
        { key: 'waiting_offer', label: 'Ждут оффера', test: r => !!r.waiting_offer },
        { key: 'paid_full', label: 'Оплачены полностью', test: r => r.remaining != null && !owes(r) },
        { key: 'mismatch', label: 'Не сходится с Notion', test: r => r.by_payments != null },
        { key: 'closed', label: 'Закрытые', test: r => closed(r) },
        { key: 'all', label: 'Все', test: () => true },
        { key: 'no_schedule', label: 'Графика нет', test: r => r.next_payment.kind === 'not_planned', hidden: true },
      ]}
      initialQuick={initialQuick}
      groupFields={['Статус', 'МЗК', 'Набор']}
      filterFields={['МЗК', 'Статус', 'Набор', 'Степень', 'График']}
      defaultSort={{ field: 'Следующий платёж', direction: 'asc' }}
      searchText={r => [r.student_name, r.mzk_name ?? '', numberOf(r)]}
      initialSearch={params.get('q') ?? ''}
      storageKey="finance-contracts-fields-v2"
      countLabel="Договоров"
      totals={rows => ({ 'Сумма': sum(rows, r => r.amount), 'Оплачено': sum(rows, r => r.paid), 'Остаток': sum(rows, r => r.remaining) })}
      exportName="договоры"
      exportValue={(r, f) => f === 'Сумма' ? money(r.amount, r.currency) : f === 'Оплачено' ? money(r.paid, r.currency)
        : f === 'Остаток' ? money(r.remaining, r.currency) : f === 'Следующий платёж' ? (r.next_payment.item?.due_date ? `${date(r.next_payment.item.due_date)} ${money(r.next_payment.item.left, r.currency)}` : NEXT_LABEL[r.next_payment.kind]) : values(r, f).join(', ')}
      empty="По выбранным условиям договоров нет."
    />
  )
}
