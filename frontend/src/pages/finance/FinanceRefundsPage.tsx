import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFinanceMode } from '@/components/finance/useFinanceMode'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type PaymentMethod, type RefundRow } from '@/api/finance'
import { FinButton, FinField, FinInput, FinModal, FinPageHeader, FinSelect, MoneyInput } from '@/components/finance/ui'
import { NotionTable } from '@/components/finance/NotionTable'
import { METHOD_LABELS, date, formatAmountInput, localIso, money, num, parseAmountInput } from '@/components/finance/format'

function PayoutDialog({ row, onClose }: { row: RefundRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(localIso())
  const [method, setMethod] = useState<PaymentMethod>('bank')
  const [note, setNote] = useState('')
  useEffect(() => { if (row) { setAmount(formatAmountInput(row.approved ?? row.requested ?? '')); setPaidAt(localIso()); setMethod('bank'); setNote('') } }, [row])
  const value = parseAmountInput(amount)
  const save = useMutation({
    mutationFn: () => financeApi.refundPayout(row!.id, { amount: String(value), paid_at: paidAt, method, note: note.trim() || null }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: financeKeys.all })
      toast({ title: 'Возврат выплачен', description: r.cancelled_items ? `Отменено неоплаченных платежей графика: ${r.cancelled_items}. Менеджер обновит статус в Notion.` : 'Менеджер обновит статус в Notion.' })
      onClose()
    },
    onError: (err) => toast({ title: 'Выплата не сохранена', description: getErrorMessage(err), variant: 'destructive' }),
  })
  return (
    <FinModal open={!!row} onClose={onClose} title="Выплатить возврат"
      context={row ? `${row.student_name ?? ''} · согласовано ${money(row.approved ?? row.requested)}` : undefined}
      footer={<><FinButton onClick={onClose}>Отмена</FinButton><FinButton variant="primary" disabled={value <= 0 || !paidAt || save.isPending} onClick={() => save.mutate()}>Сохранить выплату</FinButton></>}>
      <p className="mb-4 text-sm text-p-muted">Неоплаченные платежи графика по договору будут отменены (останутся в истории).</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FinField label="Сумма, ₸" required htmlFor="rf-amount"><MoneyInput id="rf-amount" value={amount} onChange={setAmount} required /></FinField>
        <FinField label="Дата выплаты" required htmlFor="rf-date"><FinInput id="rf-date" type="date" max={localIso()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></FinField>
        <FinField label="Способ" htmlFor="rf-method">
          <FinSelect id="rf-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['bank', 'kaspi', 'cash', 'other'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Платёжный документ, комментарий" htmlFor="rf-note"><FinInput id="rf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Например: п/п №123" /></FinField>
      </div>
    </FinModal>
  )
}

/** «Возвраты» (задание 9): запрошен → согласован → выплачен. Заявку создаёт МЗК
 * в «Возвратных кейсах», согласует руководитель, выплачивает финансист здесь. */
export function FinanceRefundsPage() {
  const navigate = useNavigate()
  const { canEdit: canManage } = useFinanceMode()
  const [paying, setPaying] = useState<RefundRow | null>(null)
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: [...financeKeys.all, 'refunds'], queryFn: financeApi.refunds })
  return (
    <div>
      <FinPageHeader title="Возвраты" description="Заявку создаёт МЗК, сумму согласует руководитель, выплату отмечает финансист. Возврат уменьшает «по оплатам» и идёт в отчётах отдельной строкой." />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      <NotionTable<RefundRow>
        rows={data?.items}
        loading={isPending}
        error={error}
        onRetry={() => refetch()}
        rowKey={(r) => r.id}
        title={{ field: 'Ученик', text: (r) => r.student_name ?? '—', onOpen: (r) => { if (r.contract_id) navigate(`/finance/contracts/${r.contract_id}`) } }}
        base={['Статус', 'Запрошено', 'Согласовано', 'Выплачено', 'Причина', 'Оплачено по договору', 'Закрыто актами']}
        extra={['Открыт', 'Выплачено менторам']}
        numeric={['Запрошено', 'Согласовано', 'Выплачено', 'Оплачено по договору', 'Выплачено менторам']}
        dates={['Открыт']}
        values={(r, f) => {
          if (f === 'Статус') return [r.stage]
          if (f === 'Запрошено') return r.requested ? [String(num(r.requested))] : []
          if (f === 'Согласовано') return r.approved ? [String(num(r.approved))] : []
          if (f === 'Выплачено') return r.paid_amount ? [String(num(r.paid_amount))] : []
          if (f === 'Причина') return r.reason ? [r.reason] : []
          if (f === 'Оплачено по договору') return r.contract_paid ? [String(num(r.contract_paid))] : []
          if (f === 'Закрыто актами') return r.services_total ? [`${r.services_closed} из ${r.services_total}`] : []
          if (f === 'Открыт') return r.opened_at ? [r.opened_at.slice(0, 10)] : []
          if (f === 'Выплачено менторам') return r.mentor_paid ? [String(num(r.mentor_paid))] : []
          return []
        }}
        cell={(r, f) => {
          if (f === 'Запрошено') return r.requested ? money(r.requested) : '—'
          if (f === 'Согласовано') return r.approved ? money(r.approved) : '—'
          if (f === 'Выплачено') return r.paid_amount ? <span>{money(r.paid_amount)}<span className="block text-xs text-p-muted">{date(r.paid_at)}</span></span> : '—'
          if (f === 'Оплачено по договору') return r.contract_paid ? money(r.contract_paid) : '—'
          if (f === 'Выплачено менторам') return r.mentor_paid ? money(r.mentor_paid) : '—'
          if (f === 'Причина') return <span className="block max-w-[260px] truncate" title={r.reason ?? ''}>{r.reason ?? '—'}</span>
          if (f === 'Открыт') return date(r.opened_at)
          return undefined
        }}
        action={(r) => canManage && r.stage === 'Согласован' ? <FinButton size="sm" onClick={() => setPaying(r)}>Выплатить</FinButton> : null}
        exclusiveQuick
        quick={[
          { key: 'all', label: 'Все', test: () => true },
          { key: 'req', label: 'Запрошены', test: (r) => r.stage === 'Запрошен' },
          { key: 'ok', label: 'Согласованы', test: (r) => r.stage === 'Согласован' },
          { key: 'paid', label: 'Выплачены', test: (r) => r.stage === 'Выплачен' },
          { key: 'no', label: 'Отклонены', test: (r) => r.stage === 'Отклонён' },
        ]}
        initialQuick={['all']}
        groupFields={['Статус']}
        searchText={(r) => [r.student_name ?? '', r.reason ?? '']}
        storageKey="finance-refunds-fields"
        countLabel="Возвратов"
        totals={(rows) => ({ 'Запрошено': money(rows.reduce((s, r) => s + num(r.requested), 0)), 'Согласовано': money(rows.reduce((s, r) => s + num(r.approved), 0)), 'Выплачено': money(rows.reduce((s, r) => s + num(r.paid_amount), 0)) })}
        exportName="возвраты"
        empty="Возвратов нет."
      />
      <PayoutDialog row={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
