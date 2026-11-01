import { useState } from 'react'
import { StudentActsPanel } from '@/components/students/StudentActsPanel'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type FinanceChange, type ScheduleItem } from '@/api/finance'
import {
  EmptyRow, FinAlert, FinBadge, FinButton, FinCard, FinMetrics, FinPageHeader, FinTable, FinTabs, ItemStatus, Td, Th, TotalRow,
} from '@/components/finance/ui'
import { AttachReceiptButton, PayDialog, ScheduleItemDialog } from '@/components/finance/dialogs'
import { METHOD_LABELS, date, dateTime, money, num, paymentTitle, statusLabel } from '@/components/finance/format'

type Tab = 'schedule' | 'payments' | 'history' | 'documents'

export function ChangeStatus({ change }: { change: FinanceChange }) {
  if (change.status === 'new') return <FinBadge tone="yellow">Ожидает проверки</FinBadge>
  if (change.status === 'accepted') return <FinBadge tone="ok">Подтверждено</FinBadge>
  return <FinBadge tone="neutral">Отклонено</FinBadge>
}

export function FinanceContractPage() {
  const { contractId } = useParams()
  const { can } = useAuth()
  const canManage = can('finance_desk', 'manage')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('schedule')
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const [editing, setEditing] = useState<{ item: ScheduleItem | null; amount?: number } | null>(null)
  const { data: c, isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.contract(contractId),
    queryFn: () => financeApi.contract(contractId!),
    enabled: !!contractId,
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
  const firstOpen = c.schedule.find((i) => i.state !== 'paid') ?? null
  const pending = c.changes.filter((ch) => ch.status === 'new').length

  return (
    <div>
      <FinPageHeader
        crumbs={crumbs}
        title={c.student_name}
        badges={<FinBadge tone={c.pipeline_status === 'active_work' ? 'ok' : 'neutral'}>{statusLabel(c.pipeline_status)}</FinBadge>}
        description={[
          c.mzk_name ? `МЗК ${c.mzk_name}` : 'МЗК не указан',
          c.intake_year ? `поступление ${c.intake_year}` : null,
          c.signed_date ? `договор от ${date(c.signed_date)}` : null,
          c.synced_at ? `сверено с Notion ${dateTime(c.synced_at)}` : null,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('contracts', 'manage') && (
              <Link to={`/students/${c.student_id}`} className="inline-flex h-[38px] items-center rounded-lg border border-p-line bg-white px-4 text-sm font-semibold text-p-text hover:bg-[var(--fin-head)]">
                Изменить договор
              </Link>
            )}
            {canManage && firstOpen && <FinButton variant="primary" onClick={() => setPaying(firstOpen)}>Отметить оплату</FinButton>}
          </>
        }
      />

      {outside !== null && Math.abs(outside) >= 1 && (
        <FinAlert action={canManage && outside > 0 && <FinButton size="sm" onClick={() => setEditing({ item: null, amount: outside })}>Добавить платёж</FinButton>}>
          {outside > 0
            ? <>Остаток {money(c.remaining)}, а в графике только {money(c.scheduled)}. <b>{money(outside)}</b> нет в графике.</>
            : <>В графике {money(c.scheduled)} — это больше остатка {money(c.remaining)} на <b>{money(-outside)}</b>.</>}
        </FinAlert>
      )}

      <FinMetrics columns={3} items={[
        { label: 'Сумма договора', value: money(c.amount, c.currency) },
        { label: 'Оплачено', value: money(c.paid, c.currency), tone: 'ok', progress: amount > 0 ? (paid / amount) * 100 : 0,
          hint: amount > 0 ? `${Math.round((paid / amount) * 100)}% договора` : undefined },
        { label: 'Осталось оплатить', value: money(c.remaining, c.currency) },
      ]} />

      <div className="mt-6">
        <FinTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'schedule', label: 'График платежей', count: c.schedule.length },
            { value: 'payments', label: 'Оплаты', count: c.payments.length },
            { value: 'history', label: 'Изменения сумм и дат', count: pending },
            { value: 'documents', label: 'Документы и акты' },
          ]}
        />
        {tab === 'documents' && <div className="mt-4"><StudentActsPanel studentId={c.student_id} financialContractId={c.contract_id} /></div>}
        {tab === 'schedule' && (
          <FinCard title="График платежей" actions={canManage && <FinButton size="sm" onClick={() => setEditing({ item: null })}>+ Платёж</FinButton>}>
            <FinTable minWidth={820}>
              <thead><tr><Th>За что</Th><Th>Срок оплаты</Th><Th right>Сумма</Th><Th right>Оплачено</Th><Th>Статус</Th><Th right> </Th></tr></thead>
              <tbody>
                {c.schedule.length === 0 && (outside === null || outside < 1) && <EmptyRow colSpan={6}>Платежей в графике нет</EmptyRow>}
                {c.schedule.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      {canManage ? <button type="button" onClick={() => setEditing({ item: i })} className="text-left hover:underline">{paymentTitle(i)}</button> : paymentTitle(i)}
                      {i.note && <div className="text-[13px] text-[var(--fin-text-3)]">{i.note}</div>}
                    </Td>
                    <Td className="whitespace-nowrap">{date(i.due_date)}</Td>
                    <Td right className="font-semibold">{money(i.amount, i.currency)}</Td>
                    <Td right>{num(i.paid) > 0 ? money(i.paid, i.currency) : '—'}</Td>
                    <Td><ItemStatus item={i} /></Td>
                    <Td right>
                      {canManage && i.state !== 'paid' && (
                        <span className="inline-flex gap-2">
                          {i.state === 'overdue' && c.mzk_name && (
                            <FinButton size="sm" variant="ghost" disabled={remind.isPending} onClick={() => remind.mutate(i)}>Напомнить МЗК</FinButton>
                          )}
                          <FinButton size="sm" onClick={() => setPaying(i)}>Отметить оплату</FinButton>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
                {outside !== null && outside >= 1 && (
                  <tr>
                    <Td className="text-[var(--fin-text-3)]">Остаток вне графика</Td>
                    <Td>—</Td>
                    <Td right className="font-semibold text-[var(--fin-warn)]">{money(outside, c.currency)}</Td>
                    <Td right>—</Td>
                    <Td><FinBadge tone="dashed">Нет в графике</FinBadge></Td>
                    <Td right>{canManage && <FinButton size="sm" onClick={() => setEditing({ item: null, amount: outside })}>Добавить</FinButton>}</Td>
                  </tr>
                )}
                {c.schedule.length > 0 && (
                  <TotalRow>
                    <Td colSpan={2}>Итого по графику</Td>
                    <Td right>{money(c.schedule.reduce((s, i) => s + num(i.amount), 0), c.currency)}</Td>
                    <Td right>{money(c.schedule.reduce((s, i) => s + num(i.paid), 0), c.currency)}</Td>
                    <Td colSpan={2} />
                  </TotalRow>
                )}
              </tbody>
            </FinTable>
          </FinCard>
        )}
        {tab === 'payments' && (
          <FinCard title="Оплаты, отмеченные в платформе">
            <FinTable minWidth={720}>
              <thead><tr><Th>Дата оплаты</Th><Th>За что</Th><Th>Способ</Th><Th right>Сумма</Th><Th>Чек</Th><Th>Отметил</Th></tr></thead>
              <tbody>
                {c.payments.length === 0 && <EmptyRow colSpan={6}>Оплат в платформе ещё не отмечали</EmptyRow>}
                {c.payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap">{date(p.paid_at)}</Td>
                    <Td>{paymentTitle(p)}</Td>
                    <Td>{p.method ? METHOD_LABELS[p.method] : '—'}</Td>
                    <Td right className="font-semibold">{money(p.amount, p.currency)}</Td>
                    <Td>{p.has_receipt ? <FinBadge tone="ok">Есть</FinBadge> : (
                      <span className="inline-flex items-center gap-2"><FinBadge tone="yellow">Нет чека</FinBadge>{canManage && <AttachReceiptButton paymentId={p.id} />}</span>
                    )}</Td>
                    <Td className="whitespace-nowrap text-[13px] text-p-muted">{p.recorded_by ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
          </FinCard>
        )}
        {tab === 'history' && (
          <FinCard title="Изменения сумм и дат" actions={pending > 0 && <Link to="/finance/review" className="text-sm font-semibold text-p-text underline">Проверить</Link>}>
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
      <PayDialog item={paying} onClose={() => setPaying(null)} />
      <ScheduleItemDialog
        open={!!editing}
        contractId={c.contract_id}
        item={editing?.item}
        presetAmount={editing?.amount}
        undistributed={outside}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
