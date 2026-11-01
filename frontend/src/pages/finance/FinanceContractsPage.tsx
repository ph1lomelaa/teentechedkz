import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { QueryError } from '@/components/shared/QueryState'
import { financeApi, financeKeys, type FinanceContractRow } from '@/api/finance'
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'
import {
  EmptyRow, FinBadge, FinButton, FinCard, FinFilterBar, FinInput, FinPageHeader, FinSelect, FinTable, StudentCell, Td, Th,
} from '@/components/finance/ui'
import { date, downloadCsv, money, num, plural, statusLabel } from '@/components/finance/format'

const NEXT_LABELS = {
  overdue: 'Просрочен', today: 'Сегодня', planned: '', paid_full: 'Оплачен полностью', not_planned: 'Графика нет',
} as const

export function NextPayment({ row }: { row: FinanceContractRow }) {
  const { kind, item } = row.next_payment
  if (kind === 'overdue') return <FinBadge tone="bad">Просрочен{item ? ` · ${date(item.due_date)}` : ''}</FinBadge>
  if (kind === 'today') return <FinBadge tone="yellow">Сегодня</FinBadge>
  if (kind === 'paid_full') return <FinBadge tone="ok">Оплачен полностью</FinBadge>
  if (kind === 'not_planned') return <FinBadge tone="dashed">Графика нет</FinBadge>
  return <span className="whitespace-nowrap">{date(item?.due_date)} · {money(item?.left)}</span>
}

export function PaidBar({ paid, amount }: { paid: string; amount: string | null }) {
  const total = num(amount)
  const pct = total > 0 ? Math.min(100, Math.round((num(paid) / total) * 100)) : 0
  return (
    <div className="min-w-[150px]">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--fin-neutral-bg)]" aria-hidden="true">
        <div className="h-full rounded-full bg-[var(--fin-ok)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 whitespace-nowrap text-[13px] text-[var(--fin-text-3)]">{money(paid)} · {pct}%</div>
    </div>
  )
}

export function FinanceContractsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const status = params.get('status') ?? 'active_work'
  const mzk = params.get('mzk') ?? ''
  const intake = params.get('intake') ?? ''
  const schedule = (params.get('schedule') ?? '') as '' | 'mismatch' | 'none'
  const page = Number(params.get('page') ?? '1') || 1
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }
  const documents = params.get('documents') ?? 'all'
  const query = { documents, q: params.get('q') ?? '', status, mzk, intake: intake ? Number(intake) : ('' as const), schedule, page }
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.contracts(query),
    queryFn: () => financeApi.contracts(query),
    placeholderData: keepPreviousData,
  })
  const rows = data?.items ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1

  return (
    <div>
      <FinPageHeader
        title="Договоры"
        description="Сумма договора, оплаты и следующий платёж по графику."
        actions={
          <FinButton disabled={!rows.length} onClick={() => downloadCsv('договоры.csv', ['Ученик', 'Год поступления', 'МЗК', 'Договор', 'Оплачено', 'Остаток', 'Следующий платёж'],
            rows.map((r) => [r.student_name, r.intake_year, r.mzk_name, money(r.amount), money(r.paid), money(r.remaining), r.next_payment.item ? date(r.next_payment.item.due_date) : NEXT_LABELS[r.next_payment.kind]]))}>
            Экспорт
          </FinButton>
        }
      />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      <FinCard>
        <FinFilterBar summary={data ? plural(data.total, ['договор', 'договора', 'договоров']) : undefined}>
          <form onSubmit={(e) => { e.preventDefault(); set({ q }) }} className="relative w-56">
            <label className="sr-only" htmlFor="fin-contracts-q">Имя ученика</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fin-text-3)]" />
            <FinInput id="fin-contracts-q" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => set({ q })} placeholder="Имя ученика" className="pl-9" />
          </form>
          <FinSelect aria-label="Статус договора" value={status} onChange={(e) => set({ status: e.target.value })} className="w-52">
            <option value="all">Все статусы</option>
            {(Object.keys(PIPELINE_STATUS_LABELS) as PipelineStatus[]).map((s) => <option key={s} value={s}>{PIPELINE_STATUS_LABELS[s]}</option>)}
          </FinSelect>
          <FinSelect aria-label="МЗК" value={mzk} onChange={(e) => set({ mzk: e.target.value })} className="w-44">
            <option value="">Все МЗК</option>
            {data?.mzk_options.map((m) => <option key={m} value={m}>{m}</option>)}
          </FinSelect>
          <FinSelect aria-label="Год поступления" value={intake} onChange={(e) => set({ intake: e.target.value })} className="w-48">
            <option value="">Любой год поступления</option>
            {data?.intake_options.map((y) => <option key={y} value={y}>{y}</option>)}
          </FinSelect>
          <FinSelect aria-label="Документы" value={documents} onChange={e => set({ documents: e.target.value })} className="w-52">
            <option value="all">Документы: все</option><option value="no_contract">Нет договора TrustMe</option><option value="no_act">Нет готовых актов</option>
          </FinSelect>
          {/* Бывшая таблица «Расхождения в графиках» из «Проверки» — теперь фильтр. */}
          <FinSelect aria-label="График платежей" value={schedule} onChange={(e) => set({ schedule: e.target.value })} className="w-60">
            <option value="">График: любой</option>
            <option value="mismatch">Остаток не совпадает с графиком</option>
            <option value="none">Графика ещё нет</option>
          </FinSelect>
        </FinFilterBar>
        <FinTable minWidth={980}>
          <thead><tr><Th>Ученик</Th><Th>МЗК</Th><Th right>Договор</Th><Th>Оплачено</Th><Th right>Остаток</Th><Th>Следующий платёж</Th><Th>Документы</Th></tr></thead>
          <tbody>
            {isLoading && <EmptyRow colSpan={7}>Загрузка…</EmptyRow>}
            {data && rows.length === 0 && <EmptyRow colSpan={7}>Договоров с такими условиями нет</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.contract_id} className="hover:bg-[var(--fin-head)]">
                <Td><StudentCell name={r.student_name} sub={r.intake_year ? `Поступление ${r.intake_year}` : statusLabel(r.pipeline_status)} onOpen={() => navigate(`/finance/contracts/${r.contract_id}`)} /></Td>
                <Td className="whitespace-nowrap">{r.mzk_name ?? '—'}</Td>
                <Td right>{money(r.amount, r.currency)}</Td>
                <Td><PaidBar paid={r.paid} amount={r.amount} /></Td>
                <Td right className="font-semibold">{money(r.remaining, r.currency)}</Td>
                <Td><NextPayment row={r} /></Td><Td>TrustMe: {r.trustme_count ?? 0} · Акты: {r.acts_count ?? 0}</Td>
              </tr>
            ))}
          </tbody>
        </FinTable>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-p-line px-5 py-3 text-[13px] text-p-muted">
            <span>Страница {page} из {pages}</span>
            <span className="flex gap-2">
              <FinButton size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Назад</FinButton>
              <FinButton size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Вперёд</FinButton>
            </span>
          </div>
        )}
      </FinCard>
    </div>
  )
}
