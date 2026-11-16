import { useState } from 'react'
import { StudentActsPanel } from '@/components/students/StudentActsPanel'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useFinanceMode } from '@/components/finance/useFinanceMode'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type ReceivedPayment, type FinanceChange, type ScheduleItem } from '@/api/finance'
import {
  EmptyRow, FinBadge, FinButton, FinCard, FinMetrics, FinPageHeader, FinTable, FinTabs, ItemStatus, Td, Th, TotalRow,
} from '@/components/finance/ui'
import { AllocatePaymentDialog, AttachReceiptButton, PayDialog, PaymentEditDialog, ScheduleItemDialog, SchedulePlanDialog } from '@/components/finance/dialogs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover'
import { MoreHorizontal } from 'lucide-react'
import { ContractDocument } from '@/components/finance/ContractDocument'
import { METHOD_LABELS, date, dateTime, money, num, paymentTitle, plural, statusLabel } from '@/components/finance/format'
import { PAYER_LABELS } from '@/api/finance'

type Tab = 'schedule' | 'payments' | 'debt' | 'history' | 'documents'

const ROW_MENU = 'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--fin-head)]'

export function ChangeStatus({ change }: { change: FinanceChange }) {
  if (change.status === 'new') return <FinBadge tone="yellow">Ожидает проверки</FinBadge>
  if (change.status === 'accepted') return <FinBadge tone="neutral">Подтверждено</FinBadge>
  return <FinBadge tone="neutral">Проверено, без изменения графика</FinBadge>
}

export function FinanceContractPage() {
  const { contractId } = useParams()
  const { can } = useAuth()
  const { canEdit: canManage, viewOnly } = useFinanceMode()
  const queryClient = useQueryClient()
  const [allocating, setAllocating] = useState<ReceivedPayment | null>(null)
  const [tab, setTab] = useState<Tab>('schedule')
  const [showCancelled, setShowCancelled] = useState(false)
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const [payingContract, setPayingContract] = useState(false)
  const [fixing, setFixing] = useState<ReceivedPayment | null>(null)
  const [editing, setEditing] = useState<{ item: ScheduleItem | null; amount?: number; cancel?: boolean } | null>(null)
  const [planning, setPlanning] = useState(false)
  const { data: c, isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.contract(contractId),
    queryFn: () => financeApi.contract(contractId!),
    enabled: !!contractId,
  })
  const checked = useMutation({
    mutationFn: () => financeApi.documentsChecked(contractId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: financeKeys.all }); toast({ title: 'Документы отмечены как проверенные' }) },
    onError: (err) => toast({ title: 'Не сохранено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const remind = useMutation({
    mutationFn: (i: ScheduleItem) => financeApi.remind(i.id),
    onSuccess: (res) => toast({ title: res.already_sent ? 'Сегодня МЗК уже напоминали' : 'Напоминание отправлено МЗК' }),
    onError: (err) => toast({ title: 'Напоминание не отправлено', description: getErrorMessage(err), variant: 'destructive' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: financeKeys.overdue() }),
  })

  const crumbs = (
    <>
      <Link to="/finance/contracts" className="hover:text-p-text hover:underline">Договоры</Link>
      <span className="px-1.5">/</span>
      <span className="text-p-text">{c?.student_name ?? '…'}</span>
    </>
  )
  if (isError) return <><FinPageHeader crumbs={crumbs} title="Договор" /><QueryError colorPrefix="p" error={error} onRetry={refetch} /></>
  if (isLoading || !c) return <><FinPageHeader crumbs={crumbs} title="Договор" /><p className="text-p-muted">Загрузка…</p></>

  const amount = num(c.amount)
  const paid = num(c.paid)
  const outside = c.undistributed === null ? null : num(c.undistributed)
  // Отменённые платежи не удаляются: в график и итоги не входят, видны по кнопке.
  const active = c.schedule.filter((i) => i.state !== 'cancelled')
  const cancelled = c.schedule.filter((i) => i.state === 'cancelled')
  const pending = c.changes.filter((ch) => ch.status === 'new').length
  // Остаток ведут менеджеры в Notion; если там больше, чем «сумма минус оплаты», —
  // похоже, после оплаты его не обновили (решение 1 = А, 14.11).
  const byPayments = c.amount !== null && c.amount !== undefined ? Math.max(amount - num(c.recorded_paid), 0) : null
  const notionMismatch = byPayments !== null && c.remaining !== null && c.remaining !== undefined && num(c.remaining) > byPayments
  const journal = c.journal ?? []

  return (
    <div>
      <FinPageHeader
        crumbs={crumbs}
        title={c.student_name}
        badges={<FinBadge tone="neutral">{statusLabel(c.pipeline_status)}</FinBadge>}
        description={[
          c.number ? `№ ${c.number}` : (c.originals ?? []).map((d) => d.label.match(/№\s*(.+)$/)?.[1]).filter(Boolean).map((n) => `№ ${n}`).join(', ') || null,
          c.signed_date ? `от ${date(c.signed_date)}` : null,
          c.mzk_name ? `МЗК ${c.mzk_name}` : null,
          c.phone ? `тел. ${c.phone}` : null,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            {canManage && <FinButton variant="primary" onClick={() => setPayingContract(true)}>Отметить оплату</FinButton>}
            {can('contracts', 'manage') && (
              <Link to={`/students/${c.student_id}`} className="inline-flex h-[38px] items-center rounded-lg border border-p-line bg-white px-4 text-sm font-semibold text-p-text hover:bg-[var(--fin-head)]">
                Изменить договор
              </Link>
            )}
          </>
        }
      />


      <FinMetrics columns={4} items={[
        { label: 'Сумма договора', value: money(c.amount, c.currency) },
        { label: 'Оплачено', value: money(c.paid, c.currency), tone: 'ok', progress: amount > 0 ? (paid / amount) * 100 : 0,
          hint: viewOnly ? 'По Notion' : `Отмечено оплат в платформе: ${money(c.recorded_paid, c.currency)}` },
        { label: 'Остаток', value: money(c.remaining, c.currency), hint: 'По Notion, его ведёт менеджер' },
      ]} />
      {notionMismatch && (
        <p className="-mt-2 mb-4 text-sm">В Notion остаток {money(c.remaining, c.currency)}, по оплатам {money(byPayments, c.currency)}.</p>
      )}
      {(c.services?.length ?? 0) > 0 && (
        <FinCard title="Услуги" className="mb-5">
          <FinTable minWidth={640}>
            <thead><tr><Th>Услуга</Th><Th right>Сумма</Th><Th right>Оплачено</Th><Th right>Остаток</Th></tr></thead>
            <tbody>
              {c.services!.map((sv) => (
                <tr key={sv.service}>
                  <Td>{sv.service}</Td>
                  <Td right>{money(sv.amount, c.currency)}</Td>
                  <Td right>{sv.paid !== null ? money(sv.paid, c.currency) : '—'}</Td>
                  <Td right className="font-semibold">{sv.remaining !== null ? money(sv.remaining, c.currency) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </FinTable>
        </FinCard>
      )}

      <div className="mt-6">
        <FinTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'schedule', label: 'График платежей', count: active.length },
            { value: 'payments', label: 'Оплаты', count: c.payments.filter((p) => p.status !== 'cancelled').length },
            ...((c.debt_actions?.length ?? 0) > 0 || c.schedule.some((i) => i.state === 'overdue')
              ? [{ value: 'debt' as Tab, label: 'Долг', count: c.debt_actions?.length ?? 0 }] : []),
            { value: 'history', label: 'История', count: journal.length },
            { value: 'documents', label: 'Документы', count: (c.originals?.length ?? 0) + c.payments.filter((p) => p.has_receipt && p.status !== 'cancelled').length },
          ]}
        />
        {tab === 'documents' && (
          <div className="grid gap-4">
            <FinCard title="Договор и допсоглашения"
              meta={c.documents_checked_at ? `проверено: ${c.documents_checked_by ?? '—'}, ${dateTime(c.documents_checked_at)}` : 'не проверено'}
              actions={canManage && <FinButton size="sm" disabled={checked.isPending} onClick={() => checked.mutate()}>{c.documents_checked_at ? 'Проверено снова' : 'Документы проверены'}</FinButton>}>
              <div className="grid gap-3 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-3"><span className="w-40 text-p-muted">Договор</span><ContractDocument studentId={c.student_id} contractId={c.contract_id} documents={c.originals} /></div>
                <div className="flex flex-wrap items-center gap-3"><span className="w-40 text-p-muted">Допсоглашения</span>
                  {(c.addenda?.length ?? 0) > 0
                    ? <ContractDocument studentId={c.student_id} contractId={c.contract_id} documents={c.addenda!.map((d) => ({ kind: 'scan' as const, id: d.id, label: d.label }))} />
                    : <span className="text-p-muted2">—</span>}
                </div>
                <p className="text-[13px] text-p-muted">Сканы договора и допсоглашений загружает МЗК в карточке ученика.</p>
              </div>
            </FinCard>
            {(c.act_cells?.length ?? 0) > 0 && (
              <FinCard title="Акты по услугам">
                <FinTable minWidth={560}>
                  <thead><tr><Th>Услуга</Th><Th>Акт</Th><Th>Дата</Th></tr></thead>
                  <tbody>
                    {c.act_cells!.map((a) => (
                      <tr key={a.service}>
                        <Td>{a.service}</Td>
                        <Td className={a.state === 'missing' ? 'font-semibold' : undefined}>{a.label}</Td>
                        <Td>{a.date ? date(a.date) : '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </FinTable>
              </FinCard>
            )}
            <FinCard title="Чеки" meta={plural(c.payments.filter((p) => p.has_receipt && p.status !== 'cancelled').length, ['чек', 'чека', 'чеков'])}>
              <FinTable minWidth={560}>
                <thead><tr><Th>Дата оплаты</Th><Th right>Сумма</Th><Th>Чек</Th></tr></thead>
                <tbody>
                  {c.payments.filter((p) => p.status !== 'cancelled').map((p) => (
                    <tr key={p.id}>
                      <Td>{date(p.paid_at)}</Td>
                      <Td right>{money(p.amount, p.currency)}</Td>
                      <Td>{p.has_receipt ? 'Есть' : <span className="inline-flex items-center gap-2">Нет{canManage && <AttachReceiptButton paymentId={p.id} />}</span>}</Td>
                    </tr>
                  ))}
                  {c.payments.length === 0 && <EmptyRow colSpan={3}>Оплат ещё нет</EmptyRow>}
                </tbody>
              </FinTable>
            </FinCard>
            <FinCard title="Акты">
              <div className="p-4"><StudentActsPanel studentId={c.student_id} financialContractId={c.contract_id} /></div>
            </FinCard>
          </div>
        )}
        {tab === 'schedule' && (
          <FinCard title="График платежей" actions={canManage && <>
            <FinButton size="sm" onClick={() => setPlanning(true)}>Расписать график</FinButton>
            <FinButton size="sm" onClick={() => setEditing({ item: null })}>+ Платёж</FinButton>
          </>}>
            <FinTable minWidth={820}>
              <thead><tr><Th>За что</Th><Th>Срок оплаты</Th><Th right>Сумма</Th><Th right>Оплачено</Th><Th>Статус</Th><Th right> </Th></tr></thead>
              <tbody>
                {active.length === 0 && (outside === null || outside < 1) && <EmptyRow colSpan={6}>Платежей в графике нет</EmptyRow>}
                {active.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      {paymentTitle(i)}
                      {i.note && <div className="text-[13px] text-[var(--fin-text-3)]">{i.note}</div>}
                    </Td>
                    <Td className="whitespace-nowrap">{i.due_date ? date(i.due_date) : 'После оффера'}</Td>
                    <Td right className="font-semibold">{money(i.amount, i.currency)}</Td>
                    <Td right>{num(i.paid) > 0 ? money(i.paid, i.currency) : '—'}</Td>
                    <Td><ItemStatus item={i} /></Td>
                    <Td right>
                      {canManage && (
                        <span className="inline-flex items-center gap-2">
                          {i.state !== 'paid' && <FinButton size="sm" onClick={() => setPaying(i)}>Отметить оплату</FinButton>}
                          <Popover>
                            <PopoverTrigger aria-label={`Действия: ${paymentTitle(i)}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--fin-neutral-bg)]">
                              <MoreHorizontal className="h-4 w-4" />
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-56 p-1">
                              <button type="button" className={ROW_MENU} onClick={() => setEditing({ item: i })}>Изменить</button>
                              <button type="button" className={ROW_MENU} onClick={() => setEditing({ item: i })}>Перенести срок</button>
                              {i.state === 'overdue' && c.mzk_name && (
                                <button type="button" className={ROW_MENU} disabled={remind.isPending} onClick={() => remind.mutate(i)}>Напомнить МЗК</button>
                              )}
                              {num(i.paid) === 0 && <button type="button" className={`${ROW_MENU} text-[var(--fin-bad)]`} onClick={() => setEditing({ item: i, cancel: true })}>Отменить платёж</button>}
                            </PopoverContent>
                          </Popover>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
                {outside !== null && outside >= 1 && (
                  <tr>
                    <Td className="text-[var(--fin-text-3)]">Остаток вне графика</Td>
                    <Td>—</Td>
                    <Td right className="font-semibold">{money(outside, c.currency)}</Td>
                    <Td right>—</Td>
                    <Td><FinBadge tone="dashed">Нет в графике</FinBadge></Td>
                    <Td right>{canManage && <FinButton size="sm" onClick={() => setPlanning(true)}>Расписать</FinButton>}</Td>
                  </tr>
                )}
                {active.length > 0 && (
                  <TotalRow>
                    <Td colSpan={2}>Итого по графику</Td>
                    <Td right>{money(active.reduce((s, i) => s + num(i.amount), 0), c.currency)}</Td>
                    <Td right>{money(active.reduce((s, i) => s + num(i.paid), 0), c.currency)}</Td>
                    <Td colSpan={2} />
                  </TotalRow>
                )}
                {showCancelled && cancelled.map((i) => (
                  <tr key={i.id} className="text-[var(--fin-text-3)]">
                    <Td>
                      <span className="line-through">{paymentTitle(i)}</span>
                      {i.cancel_reason && <div className="text-[13px]">Причина: {i.cancel_reason}</div>}
                    </Td>
                    <Td className="whitespace-nowrap line-through">{i.due_date ? date(i.due_date) : 'После оффера'}</Td>
                    <Td right className="line-through">{money(i.amount, i.currency)}</Td>
                    <Td right>—</Td>
                    <Td><ItemStatus item={i} /></Td>
                    <Td right className="whitespace-nowrap text-[13px]">{i.cancelled_at ? `отменён ${date(i.cancelled_at.slice(0, 10))}` : ''}</Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
            {cancelled.length > 0 && (
              <button type="button" className="mt-3 text-[13px] text-[var(--fin-text-3)] underline" onClick={() => setShowCancelled(v => !v)}>
                {showCancelled ? 'Скрыть отменённые' : `Показать отменённые (${cancelled.length})`}
              </button>
            )}
          </FinCard>
        )}
        {tab === 'payments' && (
          <FinCard title="Отмеченные оплаты">
            <FinTable minWidth={820}>
              <thead><tr><Th>Дата оплаты</Th><Th>За что</Th><Th>Способ</Th><Th right>Сумма</Th><Th>Чек</Th><Th>Отметил</Th><Th right> </Th></tr></thead>
              <tbody>
                {c.payments.length === 0 && <EmptyRow colSpan={7}>Оплат в платформе ещё не отмечали</EmptyRow>}
                {c.payments.map((p) => {
                  const off = p.status === 'cancelled'
                  const advance = num(p.advance)
                  return (
                    <tr key={p.id} className={off ? 'text-[var(--fin-text-3)]' : undefined}>
                      <Td className={`whitespace-nowrap ${off ? 'line-through' : ''}`}>{date(p.paid_at)}</Td>
                      <Td>
                        {p.allocations && p.allocations.length > 0
                          ? p.allocations.map((a) => (
                            <div key={a.schedule_item_id} className={off ? 'line-through' : undefined}>
                              {paymentTitle(a)}{p.allocations!.length > 1 || advance > 0 ? `: ${money(a.amount, p.currency)}` : ''}
                            </div>
                          ))
                          : <div className={off ? 'line-through' : undefined}>Вне графика</div>}
                        {!off && advance > 0 && (
                          <div className="mt-1 text-xs text-p-muted">Аванс {money(advance, p.currency)}
                            {canManage && <button type="button" className="ml-2 underline" onClick={() => setAllocating(p)}>Положить на платёж</button>}
                          </div>
                        )}
                        {p.payer && <div className="text-xs text-p-muted">Плательщик: {PAYER_LABELS[p.payer]}</div>}
                        {off && <div className="text-xs">Отменена{p.cancel_reason ? `: ${p.cancel_reason}` : ''}</div>}
                      </Td>
                      <Td>{p.method ? METHOD_LABELS[p.method] : '—'}</Td>
                      <Td right className={`font-semibold ${off ? 'line-through' : ''}`}>{money(p.amount, p.currency)}</Td>
                      <Td>{off ? '—' : p.has_receipt ? <FinBadge tone="neutral">Есть</FinBadge> : (
                        <span className="inline-flex items-center gap-2"><FinBadge tone="neutral">Нет чека</FinBadge>{canManage && <AttachReceiptButton paymentId={p.id} />}</span>
                      )}</Td>
                      <Td className="whitespace-nowrap text-[13px] text-p-muted">{p.recorded_by ?? '—'}</Td>
                      <Td right>{canManage && !off && <FinButton size="sm" variant="ghost" onClick={() => setFixing(p)}>Исправить</FinButton>}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </FinTable>
          </FinCard>
        )}
        {tab === 'debt' && (
          <FinCard title="Работа с долгом">
            <FinTable minWidth={720}>
              <thead><tr><Th>Когда</Th><Th>Что</Th><Th>Кто</Th></tr></thead>
              <tbody>
                {(c.debt_actions ?? []).length === 0 && <EmptyRow colSpan={3}>По долгу ещё ничего не делали</EmptyRow>}
                {(c.debt_actions ?? []).map((a) => (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap">{dateTime(a.at)}</Td>
                    <Td>{a.text}</Td>
                    <Td className="text-[13px] text-p-muted">{a.who ?? 'Платформа'}</Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
          </FinCard>
        )}
        {tab === 'history' && (
          <FinCard title="История денег по договору">
            <FinTable minWidth={720}>
              <thead><tr><Th>Когда</Th><Th>Что</Th><Th>Было</Th><Th>Стало</Th><Th>Кто</Th></tr></thead>
              <tbody>
                {journal.length === 0 && <EmptyRow colSpan={5}>По договору ещё ничего не происходило</EmptyRow>}
                {journal.map((j, n) => (
                  <tr key={n}>
                    <Td className="whitespace-nowrap">{dateTime(j.at)}</Td>
                    <Td>{j.what}</Td>
                    <Td className="text-[var(--fin-text-3)]">{j.old ?? '—'}</Td>
                    <Td>{j.new ?? '—'}</Td>
                    <Td className="text-[13px] text-p-muted">{j.who ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
          </FinCard>
        )}
        {tab === 'history' && c.changes.length > 0 && (
          <FinCard title="Изменения сумм и дат из Notion" actions={pending > 0 && <Link to="/finance/review" className="text-sm font-semibold text-p-text underline">Проверить</Link>}>
            <FinTable minWidth={720}>
              <thead><tr><Th>Когда</Th><Th>Что</Th><Th>Было</Th><Th>Стало</Th><Th>Где</Th><Th>Статус</Th></tr></thead>
              <tbody>
                {c.changes.length === 0 && <EmptyRow colSpan={6}>Суммы и даты по договору не меняли</EmptyRow>}
                {c.changes.map((ch) => (
                  <tr key={ch.id}>
                    <Td className="whitespace-nowrap">{dateTime(ch.created_at)}</Td>
                    <Td>{ch.field_label}</Td>
                    <Td className="text-[var(--fin-text-3)] line-through">{ch.old_label}</Td>
                    <Td className="font-semibold">{ch.new_label}</Td>
                    <Td className="text-[13px] text-p-muted">{ch.where}</Td>
                    <Td><ChangeStatus change={ch} />{ch.resolved_by && <div className="mt-1 text-xs text-p-muted">{ch.resolved_by}, {dateTime(ch.resolved_at)}</div>}</Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
          </FinCard>
        )}
      </div>
      <AllocatePaymentDialog payment={allocating} items={active} onClose={() => setAllocating(null)} />
      <PayDialog item={paying} contract={payingContract ? { id: c.contract_id, student_name: c.student_name, currency: c.currency } : null}
        onClose={() => { setPaying(null); setPayingContract(false) }} />
      <PaymentEditDialog payment={fixing} onClose={() => setFixing(null)} />
      <SchedulePlanDialog open={planning} contractId={c.contract_id}
        total={outside !== null && outside > 0 ? outside : num(c.remaining)}
        onClose={() => setPlanning(false)} onManual={() => setEditing({ item: null, amount: outside && outside > 0 ? outside : undefined })} />
      <ScheduleItemDialog
        open={!!editing}
        contractId={c.contract_id}
        startCancel={editing?.cancel}
        item={editing?.item}
        presetAmount={editing?.amount}
        undistributed={outside}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
