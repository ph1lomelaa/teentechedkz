import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFinanceMode } from '@/components/finance/useFinanceMode'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type FinanceChange, type NotionMismatch, type ReceivedPayment } from '@/api/finance'
import { FinButton, FinPageHeader, FinSelect } from '@/components/finance/ui'
import { NotionTable } from '@/components/finance/NotionTable'
import { AttachReceiptButton, ConfirmChangeDialog, PayDialog, type PayContract } from '@/components/finance/dialogs'
import { NotionScheduleNotice } from '@/components/finance/NotionScheduleNotice'
import { METHOD_LABELS, date, dateTime, money, paymentTitle, plural } from '@/components/finance/format'

/** Типы событий «Проверки» (задание 6): у каждого своё действие. */
type Kind = 'offer' | 'amount' | 'date' | 'notion' | 'schedule' | 'act' | 'receipt' | 'other'
const KIND_LABELS: Record<Kind, string> = {
  offer: 'Оффер',
  amount: 'Изменилась сумма',
  date: 'Изменилась дата',
  notion: 'Не сходится с Notion',
  schedule: 'Договор без графика',
  act: 'Нет акта',
  receipt: 'Оплата без чека',
  other: 'Другое изменение',
}
const AMOUNT_FIELDS = new Set(['client_fee', 'client_remaining', 'english_sum', 'english_paid', 'up_sum', 'up_paid', 'proforientation_sum', 'ielts_exam_fee', 'mentor_total', 'mentor_paid', 'payment_added', 'payment_changed'])

interface NoSchedule { contract_id: string; student_name: string; mzk_name: string | null; currency: string; remaining: string; remaining_date: string | null }

type Row =
  | { kind: 'offer' | 'amount' | 'date' | 'other'; key: string; at: string | null; change: FinanceChange }
  | { kind: 'notion'; key: string; at: null; mismatch: NotionMismatch }
  | { kind: 'schedule'; key: string; at: string | null; contract: NoSchedule }
  | { kind: 'receipt'; key: string; at: string | null; payment: ReceivedPayment }
  | { kind: 'act'; key: string; at: null; act: { contract_id: string; student_name: string; mzk_name: string | null; missing: number; total: number } }

const kindOf = (c: FinanceChange): 'offer' | 'amount' | 'date' | 'other' =>
  c.field === 'offer_received' || c.field === 'offer_cancelled' ? 'offer'
    : c.field === 'client_remaining_date' ? 'date' : AMOUNT_FIELDS.has(c.field) ? 'amount' : 'other'

/**
 * «Проверка»: один список того, что ждёт решения финансиста, с фильтром по
 * типу. Оффер сюда не попадает — он на «Платежах» («Выставить»).
 */
export function FinanceReviewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit: canManage, viewOnly, canMarkSeen } = useFinanceMode()
  const [history, setHistory] = useState(false)
  const [confirming, setConfirming] = useState<FinanceChange | null>(null)
  const [paying, setPaying] = useState<PayContract | null>(null)
  const status = history ? 'all' : 'new'
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: financeKeys.review(status, 0), queryFn: () => financeApi.review(status, 0) })
  const today = useQuery({ queryKey: financeKeys.today(), queryFn: financeApi.today })

  const done = () => queryClient.invalidateQueries({ queryKey: financeKeys.all })
  const accept = useMutation({
    mutationFn: (c: FinanceChange) => financeApi.acceptChange(c.id),
    onSuccess: () => { done(); toast({ title: 'Отмечено как просмотренное' }) },
    onError: (err) => toast({ title: 'Не сохранено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const reject = useMutation({
    mutationFn: (c: FinanceChange) => financeApi.rejectChange(c.id),
    onSuccess: () => { done(); toast({ title: 'Оставлено как есть' }) },
    onError: (err) => toast({ title: 'Не сохранено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const remindAct = useMutation({
    mutationFn: (contractId: string) => financeApi.remindAct(contractId),
    onSuccess: (res) => toast({ title: res.already ? 'Сегодня МЗК уже напоминали' : 'МЗК получил напоминание про акт' }),
    onError: (err) => toast({ title: 'Напоминание не отправлено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const remindNotion = useMutation({
    mutationFn: (m: NotionMismatch) => financeApi.remindNotion(m.contract_id),
    onSuccess: (res) => toast({ title: res.already ? 'Сегодня менеджеру уже писали' : 'Менеджеру отправлено напоминание' }),
    onError: (err) => toast({ title: 'Напоминание не отправлено', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const rows: Row[] = [
    ...(data?.changes ?? []).filter((c) => history || c.status === 'new')
      .map((c): Row => ({ kind: kindOf(c), key: `c-${c.id}`, at: c.created_at, change: c })),
    ...(history ? [] : (data?.notion_mismatches ?? []).map((m): Row => ({ kind: 'notion', key: `n-${m.contract_id}`, at: null, mismatch: m }))),
    ...(history ? [] : (data?.no_schedule ?? []).map((c): Row => ({ kind: 'schedule', key: `s-${c.contract_id}`, at: c.remaining_date, contract: c }))),
    ...(history ? [] : (data?.no_act ?? []).map((a): Row => ({ kind: 'act', key: `a-${a.contract_id}`, at: null, act: a }))),
    ...(history ? [] : (data?.no_receipt ?? []).map((p): Row => ({ kind: 'receipt', key: `r-${p.id}`, at: p.paid_at, payment: p }))),
  ]
  const counts = rows.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map<Kind, number>())
  const open = (contractId: string | null) => { if (contractId) navigate(`/finance/contracts/${contractId}`) }

  const student = (r: Row) => {
    if (r.kind === 'notion') return { name: r.mismatch.student_name, mzk: r.mismatch.mzk_name, id: r.mismatch.contract_id }
    if (r.kind === 'schedule') return { name: r.contract.student_name, mzk: r.contract.mzk_name, id: r.contract.contract_id }
    if (r.kind === 'receipt') return { name: r.payment.student_name, mzk: null, id: r.payment.contract_id }
    if (r.kind === 'act') return { name: r.act.student_name, mzk: r.act.mzk_name, id: r.act.contract_id }
    return { name: r.change.student_name, mzk: r.change.mzk_name, id: r.change.contract_id }
  }
  const what = (r: Row) => {
    if (r.kind === 'notion') return <>В Notion остаток {money(r.mismatch.notion_remaining, r.mismatch.currency)}, по оплатам {money(r.mismatch.by_payments, r.mismatch.currency)}</>
    if (r.kind === 'schedule') return <>Остаток {money(r.contract.remaining, r.contract.currency)}{r.contract.remaining_date ? ` до ${date(r.contract.remaining_date)}` : ''}, графика нет</>
    if (r.kind === 'act') return <>Договор оплачен, нет акта по {plural(r.act.missing, ['услуге', 'услугам', 'услугам'])} из {r.act.total}</>
    if (r.kind === 'receipt') return <>{paymentTitle(r.payment)} · {money(r.payment.amount, r.payment.currency)} · {r.payment.method ? METHOD_LABELS[r.payment.method] : 'способ не указан'}</>
    const c = r.change
    if (r.kind === 'offer') return <>{c.field_label}: <span className="font-semibold">{c.new_label}</span> <span className="text-[13px] text-p-muted">· {c.where}</span></>
    return <>{c.field_label}: <span className="text-[var(--fin-text-3)] line-through">{c.old_label}</span> → <span className="font-semibold">{c.new_label}</span> <span className="text-[13px] text-p-muted">· {c.where}</span></>
  }
  const actions = (r: Row) => {
    if (!canManage && !(viewOnly && canMarkSeen)) return null
    if (r.kind === 'notion') return <>
      {r.mismatch.mzk_name && <FinButton size="sm" variant="ghost" disabled={remindNotion.isPending} onClick={() => remindNotion.mutate(r.mismatch)}>Сообщить менеджеру</FinButton>}
      <FinButton size="sm" onClick={() => setPaying({ id: r.mismatch.contract_id, student_name: r.mismatch.student_name, currency: r.mismatch.currency })}>Внести недостающую оплату</FinButton>
    </>
    if (r.kind === 'schedule') return <FinButton size="sm" onClick={() => open(r.contract.contract_id)}>Расписать график</FinButton>
    if (r.kind === 'act') return r.act.mzk_name
      ? <FinButton size="sm" disabled={remindAct.isPending} onClick={() => remindAct.mutate(r.act.contract_id)}>Напомнить МЗК</FinButton>
      : <span className="text-[13px] text-p-muted">МЗК не назначен</span>
    if (r.kind === 'receipt') return <AttachReceiptButton paymentId={r.payment.id} label="Прикрепить чек" />
    const c = r.change
    if (viewOnly && c.status === 'new') {
      // Режим «только просмотр» (15.11): одна кнопка на событие.
      return canMarkSeen ? <FinButton size="sm" disabled={accept.isPending} onClick={() => accept.mutate(c)}>Просмотрено</FinButton> : null
    }
    if (c.status !== 'new') {
      return <span className="text-[13px] text-p-muted">{c.status === 'accepted' ? 'Разобрал' : 'Оставил как есть'} {c.resolved_by ?? '—'}, {dateTime(c.resolved_at)}{c.schedule_item_id ? ', платёж перенесён' : ''}</span>
    }
    if (r.kind === 'date') return <>
      <FinButton size="sm" variant="ghost" disabled={reject.isPending} onClick={() => reject.mutate(c)}>Оставить как есть</FinButton>
      <FinButton size="sm" onClick={() => setConfirming(c)}>Перенести платёж</FinButton>
    </>
    if (r.kind === 'amount') return <>
      <FinButton size="sm" variant="ghost" disabled={accept.isPending} onClick={() => accept.mutate(c)}>Просмотрено</FinButton>
      <FinButton size="sm" onClick={() => { accept.mutate(c); open(c.contract_id) }}>Исправить график</FinButton>
    </>
    return <FinButton size="sm" variant="ghost" disabled={accept.isPending} onClick={() => accept.mutate(c)}>Просмотрено</FinButton>
  }

  return (
    <div>
      <FinPageHeader title="Проверка" description={viewOnly ? 'Изменения денег в Notion и офферы. Отметьте «Просмотрено», когда увидели.' : 'Всё, что ждёт решения: изменения сумм и дат, расхождения с Notion, договоры без графика, оплаты без чека.'} />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {today.data && !viewOnly && <NotionScheduleNotice count={today.data.notion_import_count} canManage={canManage} />}
      <NotionTable<Row>
        rows={isLoading ? undefined : rows}
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        rowKey={(r) => r.key}
        title={{ field: 'Ученик', text: (r) => student(r).name, onOpen: (r) => open(student(r).id), notion: (r) => 'change' in r ? r.change.notion_url : null }}
        base={['Тип', 'Что', 'Когда']}
        extra={['МЗК']}
        dates={['Когда']}
        values={(r, f) => {
          const st = student(r)
          if (f === 'Тип') return [KIND_LABELS[r.kind]]
          if (f === 'МЗК') return st.mzk ? [st.mzk] : []
          if (f === 'Когда') return r.at ? [r.at.slice(0, 10)] : []
          if (f === 'Что' && 'change' in r) return [`${r.change.field_label} ${r.change.new_label}`]
          return []
        }}
        cell={(r, f) => {
          if (f === 'Тип') return <span className="text-[13px] text-p-muted">{KIND_LABELS[r.kind]}</span>
          if (f === 'Что') return <span className="block w-[320px] whitespace-normal">{what(r)}</span>
          if (f === 'Когда') return <span className="text-[13px]">{r.kind === 'amount' || r.kind === 'date' || r.kind === 'other' || r.kind === 'offer' ? dateTime(r.at) : r.at ? date(r.at) : '—'}</span>
          return undefined
        }}
        action={(r) => <span className="inline-flex flex-wrap justify-end gap-2">{actions(r)}</span>}
        exclusiveQuick
        quick={(['all', 'offer', 'amount', 'date', 'notion', 'schedule', 'act', 'receipt', 'other'] as const)
          .filter((k) => k === 'all' || counts.get(k))
          .map((k) => ({ key: k, label: k === 'all' ? 'Все' : KIND_LABELS[k], test: (r: Row) => k === 'all' || r.kind === k }))}
        initialQuick={['all']}
        extraControls={
          <FinSelect aria-label="Показать" value={history ? 'all' : 'new'} onChange={(e) => setHistory(e.target.value === 'all')} className="h-8 w-56">
            <option value="new">Ждут решения</option>
            <option value="all">Все изменения сумм и дат</option>
          </FinSelect>
        }
        groupFields={['Тип', 'МЗК']}
        filterFields={['МЗК']}
        defaultSort={{ field: 'Когда', direction: 'desc' }}
        searchText={(r) => [student(r).name, student(r).mzk ?? '']}
        storageKey="finance-review-fields"
        countLabel={history ? 'Изменений' : 'Ждут решения'}
        exportName="проверка"
        empty={history ? 'Изменений сумм и дат не было' : 'Всё разобрано, ничего не ждёт решения'}
      />
      <ConfirmChangeDialog change={confirming} onClose={() => setConfirming(null)} />
      <PayDialog item={null} contract={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
