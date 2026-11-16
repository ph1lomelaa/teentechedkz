import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useFinanceMode } from '@/components/finance/useFinanceMode'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorCode, getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys } from '@/api/finance'
import { EmptyRow, FinButton, FinCard, FinField, FinInput, FinPageHeader, FinSelect, FinTable, FinTabs, Td, Th, TotalRow } from '@/components/finance/ui'
import { METHOD_LABELS, date, downloadCsv, localIso, money, num } from '@/components/finance/format'

type Tab = 'summary' | 'income' | 'aging' | 'offers' | 'close'

const prevMonth = () => { const d = new Date(); return localIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)).slice(0, 7) }
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/** Простой столбик: доля от максимума, без подписей на фоне. */
function Bar({ value, max }: { value: number; max: number }) {
  return <span className="inline-block h-2 w-28 overflow-hidden rounded-full bg-[var(--fin-neutral-bg)] align-middle"><span className="block h-full bg-p-text" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} /></span>
}

function Period({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      <FinField label="С" htmlFor="rep-from"><FinInput id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FinField>
      <FinField label="По" htmlFor="rep-to"><FinInput id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FinField>
    </div>
  )
}

/**
 * «Отчёты» (задание 12): заменяет старую «Финансы». Все цифры — из одной
 * модели и сходятся между отчётами. Экспорт — CSV, открывается в Excel.
 */
export function FinanceReportsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit: canManage, viewOnly } = useFinanceMode()
  const [tab, setTab] = useState<Tab>('summary')
  const [from, setFrom] = useState(() => localIso(new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1)))
  const [to, setTo] = useState(localIso())
  const [by, setBy] = useState('none')
  const [agingBy, setAgingBy] = useState('none')
  const [month, setMonth] = useState(prevMonth())
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const summary = useQuery({ queryKey: [...financeKeys.all, 'rep-summary'], queryFn: financeApi.reportSummary, enabled: tab === 'summary' })
  const income = useQuery({ queryKey: [...financeKeys.all, 'rep-income', from, to, by], queryFn: () => financeApi.reportIncome({ date_from: from, date_to: to, by }), enabled: tab === 'income' })
  const aging = useQuery({ queryKey: [...financeKeys.all, 'rep-aging', agingBy], queryFn: () => financeApi.reportAging(agingBy), enabled: tab === 'aging' })
  const offers = useQuery({ queryKey: [...financeKeys.all, 'rep-offers', from, to], queryFn: () => financeApi.reportOffers({ date_from: from, date_to: to }), enabled: tab === 'offers' })
  const status = useQuery({ queryKey: [...financeKeys.all, 'rep-month', month], queryFn: () => financeApi.monthStatus(month), enabled: tab === 'close' })

  const done = () => queryClient.invalidateQueries({ queryKey: financeKeys.all })
  const reconcile = useMutation({
    mutationFn: (ids: string[]) => financeApi.reconcile(ids),
    onSuccess: () => { setPicked(new Set()); done(); toast({ title: 'Отмечено: сверено с выпиской' }) },
    onError: (err) => toast({ title: 'Не сохранено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const close = useMutation({
    mutationFn: (force: boolean) => financeApi.closeMonth(month, force),
    onSuccess: () => { done(); toast({ title: `Месяц закрыт: ${monthLabel(month)}`, description: 'Оплаты за него теперь меняет только админ.' }) },
    onError: (err) => {
      if (getErrorCode(err) === 'MONTH_NOT_READY' && window.confirm(`${getErrorMessage(err)}`)) { close.mutate(true); return }
      if (getErrorCode(err) !== 'MONTH_NOT_READY') toast({ title: 'Месяц не закрыт', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const err = [summary, income, aging, offers, status].find((q) => q.isError)
  const incomeRows = income.data?.rows ?? []
  const maxFact = Math.max(0, ...incomeRows.map((r) => num(r.fact)))

  return (
    <div>
      <FinPageHeader title="Отчёты" description={viewOnly ? 'Сводка, дебиторка и офферы по данным Notion.' : 'Поступления, дебиторка, офферы и закрытие месяца. Цифры считаются из оплат платформы и остатков Notion и сходятся между отчётами.'} />
      {err && <QueryError colorPrefix="p" error={err.error} onRetry={() => err.refetch()} className="mb-5" />}
      {/* Режим «только просмотр»: оплат в платформе нет — без «Поступлений» и «Закрытия месяца». */}
      <FinTabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'summary', label: 'Сводка' },
        ...(viewOnly ? [] : [{ value: 'income' as Tab, label: 'Поступления' }]),
        { value: 'aging', label: 'Дебиторка' }, { value: 'offers', label: 'Офферы' },
        ...(viewOnly ? [] : [{ value: 'close' as Tab, label: 'Закрытие месяца' }]),
      ]} />

      {tab === 'summary' && summary.data && (
        <FinCard title="Сводка по действующим договорам" meta={`${summary.data.contracts} договоров${Number(summary.data.without_amount) ? `, без суммы: ${summary.data.without_amount}` : ''}`}>
          <FinTable minWidth={560}>
            <tbody>
              {([
                ['Сумма договоров', summary.data.amount],
                ['Оплачено (сумма минус остаток в Notion)', summary.data.paid_by_notion],
                ['Отмечено оплат в платформе (минус возвраты)', summary.data.recorded_paid],
                ['Остаток по Notion', summary.data.remaining_notion],
                ['в том числе просрочено по графику', summary.data.overdue],
                ['в том числе ждёт оффера', summary.data.after_offer],
              ] as const).map(([label, value]) => (
                <tr key={label}><Td className={label.startsWith('в том') ? 'pl-8 text-p-muted' : undefined}>{label}</Td><Td right className="font-semibold">{money(String(value))}</Td></tr>
              ))}
            </tbody>
          </FinTable>
        </FinCard>
      )}

      {tab === 'income' && (
        <FinCard title="Поступления по месяцам">
          <div className="flex flex-wrap items-end gap-4 border-b border-p-line px-5 py-3">
            <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
            <FinField label="Разрез" htmlFor="rep-by">
              <FinSelect id="rep-by" value={by} onChange={(e) => setBy(e.target.value)}>
                <option value="none">Без разреза</option><option value="kind">По услуге</option><option value="method">По способу оплаты</option><option value="mzk">По МЗК</option>
              </FinSelect>
            </FinField>
            <span className="ml-auto"><FinButton size="sm" disabled={!incomeRows.length} onClick={() => downloadCsv('поступления.csv', ['Месяц', 'Разрез', 'План', 'Факт', 'Возвраты', 'Чистыми'], incomeRows.map((r) => [monthLabel(r.month), r.group, r.plan, r.fact, r.refunds, r.net]))}><Download className="h-4 w-4" aria-hidden="true" />Экспорт</FinButton></span>
          </div>
          <FinTable minWidth={820}>
            <thead><tr><Th>Месяц</Th>{by !== 'none' && <Th>Разрез</Th>}<Th right>План по графику</Th><Th right>Факт</Th><Th> </Th><Th right>Возвраты</Th><Th right>Чистыми</Th></tr></thead>
            <tbody>
              {income.isLoading && <EmptyRow colSpan={7}>Загрузка…</EmptyRow>}
              {income.data && !incomeRows.length && <EmptyRow colSpan={7}>За период поступлений и плана нет</EmptyRow>}
              {incomeRows.map((r) => (
                <tr key={`${r.month}-${r.group}`}>
                  <Td>{monthLabel(r.month)}</Td>{by !== 'none' && <Td>{r.group}</Td>}
                  <Td right>{money(r.plan)}</Td><Td right className="font-semibold">{money(r.fact)}</Td><Td><Bar value={num(r.fact)} max={maxFact} /></Td>
                  <Td right>{num(r.refunds) ? `−${money(r.refunds)}` : '—'}</Td><Td right className="font-semibold">{money(r.net)}</Td>
                </tr>
              ))}
              {incomeRows.length > 0 && (
                <TotalRow>
                  <Td colSpan={by !== 'none' ? 2 : 1}>Итого</Td>
                  <Td right>{money(incomeRows.reduce((s, r) => s + num(r.plan), 0))}</Td>
                  <Td right>{money(incomeRows.reduce((s, r) => s + num(r.fact), 0))}</Td><Td />
                  <Td right>{money(incomeRows.reduce((s, r) => s + num(r.refunds), 0))}</Td>
                  <Td right>{money(incomeRows.reduce((s, r) => s + num(r.net), 0))}</Td>
                </TotalRow>
              )}
            </tbody>
          </FinTable>
        </FinCard>
      )}

      {tab === 'aging' && aging.data && (
        <FinCard title="Дебиторка по срокам" meta={viewOnly ? 'остаток по Notion' : 'неоплаченное по графику'}>
          <div className="flex flex-wrap items-end gap-4 border-b border-p-line px-5 py-3">
            <FinField label="Разрез" htmlFor="rep-aging-by">
              <FinSelect id="rep-aging-by" value={agingBy} onChange={(e) => setAgingBy(e.target.value)}>
                <option value="none">Без разреза</option><option value="mzk">По МЗК</option><option value="kind">По услуге</option>
              </FinSelect>
            </FinField>
            <span className="ml-auto"><FinButton size="sm" onClick={() => downloadCsv('дебиторка.csv', ['Разрез', ...aging.data!.buckets.flatMap((b) => [`${b}, шт.`, `${b}, ₸`]), 'Итого'],
              aging.data!.rows.map((r) => [r.group, ...r.buckets.flatMap((b) => [String(b.count), b.total]), r.total]))}><Download className="h-4 w-4" aria-hidden="true" />Экспорт</FinButton></span>
          </div>
          <FinTable minWidth={960}>
            <thead><tr><Th>{agingBy === 'mzk' ? 'МЗК' : agingBy === 'kind' ? 'Услуга' : ' '}</Th>{aging.data.buckets.map((b) => <Th key={b} right>{b}</Th>)}<Th right>Итого</Th></tr></thead>
            <tbody>
              {aging.data.rows.length === 0 && <EmptyRow colSpan={aging.data.buckets.length + 2}>Неоплаченных платежей по графику нет</EmptyRow>}
              {aging.data.rows.map((r) => (
                <tr key={r.group}>
                  <Td>{r.group}</Td>
                  {r.buckets.map((b) => <Td key={b.bucket} right className={b.bucket !== 'Не наступило' && b.count ? 'text-[var(--fin-bad)]' : undefined}>{b.count ? <>{money(b.total)}<span className="block text-xs text-p-muted">{b.count} шт.</span></> : '—'}</Td>)}
                  <Td right className="font-semibold">{money(r.total)}</Td>
                </tr>
              ))}
              {aging.data.rows.length > 1 && <TotalRow><Td>Итого</Td>{aging.data.buckets.map((b) => <Td key={b} right>{money(aging.data!.rows.reduce((s, r) => s + num(r.buckets.find((x) => x.bucket === b)?.total), 0))}</Td>)}<Td right>{money(aging.data.total)}</Td></TotalRow>}
            </tbody>
          </FinTable>
        </FinCard>
      )}

      {tab === 'offers' && (
        <FinCard title="Офферы">
          <div className="border-b border-p-line px-5 py-3"><Period from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
          {offers.data && (
            <FinTable minWidth={520}>
              <tbody>
                <tr><Td>Офферов за период</Td><Td right className="font-semibold">{offers.data.offers}</Td></tr>
                <tr><Td>Договоров с оффером</Td><Td right>{offers.data.contracts}</Td></tr>
                <tr><Td>Остаток выставлен</Td><Td right>{offers.data.issued}</Td></tr>
                <tr><Td>Собрано (была оплата после оффера)</Td><Td right>{offers.data.collected}</Td></tr>
                <tr><Td>Средний срок от оффера до оплаты</Td><Td right>{offers.data.avg_days_to_payment !== null ? `${offers.data.avg_days_to_payment} дн.` : '—'}</Td></tr>
              </tbody>
            </FinTable>
          )}
        </FinCard>
      )}

      {tab === 'close' && (
        <FinCard title={`Закрытие месяца: ${monthLabel(month)}`}
          meta={status.data?.closed_at ? `закрыт ${date(status.data.closed_at.slice(0, 10))}, ${status.data.closed_by ?? ''}` : status.data ? `не сверено: ${status.data.unreconciled}, без чека: ${status.data.no_receipt}` : undefined}
          actions={<>
            <FinInput aria-label="Месяц" type="month" value={month} max={prevMonth()} onChange={(e) => { setMonth(e.target.value); setPicked(new Set()) }} className="w-40" />
            {canManage && !status.data?.closed_at && <FinButton size="sm" variant="primary" disabled={close.isPending || !status.data} onClick={() => close.mutate(false)}>Закрыть месяц</FinButton>}
          </>}>
          {status.data && (
            <>
              <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-p-line px-5 py-3 text-sm">
                {status.data.by_method.map((m) => <span key={m.method}><span className="text-p-muted">{m.method}: </span><span className="font-semibold">{money(m.total)}</span></span>)}
                <span className="text-p-muted">— сверьте с выписками Kaspi и банка за месяц</span>
              </div>
              {canManage && !status.data.closed_at && (
                <div className="flex flex-wrap gap-2 px-5 py-3">
                  <FinButton size="sm" disabled={!picked.size || reconcile.isPending} onClick={() => reconcile.mutate([...picked])}>Сверено с выпиской ({picked.size})</FinButton>
                  <FinButton size="sm" variant="ghost" onClick={() => setPicked(new Set(status.data!.payments.filter((p) => !p.reconciled).map((p) => p.id)))}>Выбрать все несверенные</FinButton>
                </div>
              )}
              <FinTable minWidth={820}>
                <thead><tr><Th> </Th><Th>Дата</Th><Th>Ученик</Th><Th>Способ</Th><Th right>Сумма</Th><Th>Чек</Th><Th>Сверено</Th></tr></thead>
                <tbody>
                  {status.data.payments.length === 0 && <EmptyRow colSpan={7}>Оплат за месяц нет</EmptyRow>}
                  {status.data.payments.map((p) => (
                    <tr key={p.id}>
                      <Td>{!p.reconciled && canManage && !status.data!.closed_at && <input type="checkbox" className="accent-black" aria-label={`Выбрать: ${p.student_name}`} checked={picked.has(p.id)}
                        onChange={(e) => setPicked((old) => { const next = new Set(old); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next })} />}</Td>
                      <Td>{date(p.paid_at)}</Td>
                      <Td><button type="button" className="underline decoration-p-line underline-offset-4" onClick={() => navigate(`/finance/contracts/${p.contract_id}`)}>{p.student_name}</button></Td>
                      <Td>{p.method ? METHOD_LABELS[p.method] : '—'}</Td>
                      <Td right className="font-semibold">{p.refund ? `−${money(p.amount)}` : money(p.amount)}</Td>
                      <Td>{p.refund ? '—' : p.has_receipt ? 'Есть' : 'Нет'}</Td>
                      <Td>{p.reconciled ? 'Да' : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </FinTable>
            </>
          )}
        </FinCard>
      )}
      {tab === 'income' && <p className="mt-3 text-[13px] text-p-muted">План — сумма платежей графика со сроком в месяце; факт — отмеченные оплаты; возвраты — выплаты возвратов клиентам.</p>}
    </div>
  )
}
