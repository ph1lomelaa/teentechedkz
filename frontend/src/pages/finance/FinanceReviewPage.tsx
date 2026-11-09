import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type FinanceChange } from '@/api/finance'
import { EmptyRow, FinButton, FinCard, FinPageHeader, FinSelect, FinTable, StudentCell, Td, Th } from '@/components/finance/ui'
import { AttachReceiptButton, ConfirmChangeDialog } from '@/components/finance/dialogs'
import { METHOD_LABELS, date, dateTime, money, paymentTitle, plural } from '@/components/finance/format'
import { ChangeStatus } from './FinanceContractPage'

export function FinanceReviewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const canManage = can('finance_desk', 'manage')
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<'new' | 'all'>('new')
  const [confirming, setConfirming] = useState<FinanceChange | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: financeKeys.review(filter, offset), queryFn: () => financeApi.review(filter, offset) })

  const done = () => queryClient.invalidateQueries({ queryKey: financeKeys.all })
  const accept = useMutation({
    mutationFn: (c: FinanceChange) => financeApi.acceptChange(c.id),
    onSuccess: () => { done(); toast({ title: 'Подтверждено' }) },
    onError: (err) => toast({ title: 'Не подтверждено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const reject = useMutation({
    mutationFn: (c: FinanceChange) => financeApi.rejectChange(c.id),
    onSuccess: () => { done(); toast({ title: 'Проверено. График оставлен без изменений' }) },
    onError: (err) => toast({ title: 'Не отклонено', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const changes = (data?.changes ?? []).filter((c) => filter === 'all' || c.status === 'new')
  const pending = data?.pending_total ?? 0

  return (
    <div>
      <FinPageHeader title="Проверка" description="Изменения сумм и дат в Notion и оплаты без чека. Договоры, где график не совпадает с остатком, — в «Договорах», фильтр «График»." />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      <div className="grid gap-5">
        <FinCard
          title="Изменения сумм и дат"
          meta={pending ? `${plural(pending, ['ожидает', 'ожидают', 'ожидают'])} проверки` : 'всё проверено'}
          actions={
            <FinSelect aria-label="Показать" value={filter} onChange={(e) => { setFilter(e.target.value as 'new' | 'all'); setOffset(0) }} className="w-48">
              <option value="new">Ожидают проверки</option>
              <option value="all">Все изменения</option>
            </FinSelect>
          }
        >
          <p className="px-5 py-3 text-sm text-p-muted">Изменения из Notion уже отражены в договоре. «Оставить график» закрывает проверку и не возвращает прежние суммы или даты.</p>
          <FinTable minWidth={1040}>
            <thead><tr><Th>Дата и время</Th><Th>Ученик</Th><Th>Что</Th><Th>Было</Th><Th>Стало</Th><Th>Где</Th><Th>Статус</Th><Th right>Решение</Th></tr></thead>
            <tbody>
              {isLoading && <EmptyRow colSpan={8}>Загрузка…</EmptyRow>}
              {data && changes.length === 0 && <EmptyRow colSpan={8}>{filter === 'new' ? 'Непроверенных изменений нет' : 'Изменений из Notion не было'}</EmptyRow>}
              {changes.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap">{dateTime(c.created_at)}</Td>
                  <Td>
                    <StudentCell name={c.student_name} sub={c.mzk_name ? `МЗК ${c.mzk_name}` : null}
                      onOpen={c.contract_id ? () => navigate(`/finance/contracts/${c.contract_id}`) : undefined} />
                  </Td>
                  <Td className="whitespace-nowrap">{c.field_label}</Td>
                  <Td className="whitespace-nowrap text-[var(--fin-text-3)] line-through">{c.old_label}</Td>
                  <Td className="whitespace-nowrap font-semibold">{c.new_label}</Td>
                  <Td className="text-[13px] text-p-muted">{c.where}</Td>
                  <Td><ChangeStatus change={c} /></Td>
                  <Td right>
                    {c.status === 'new' ? (
                      canManage && (
                        <span className="inline-flex flex-col gap-2">
                          <FinButton size="sm" variant="ghost" disabled={reject.isPending} onClick={() => reject.mutate(c)}>Оставить график</FinButton>
                          <FinButton size="sm" disabled={accept.isPending}
                            onClick={() => (c.field === 'client_remaining_date' ? setConfirming(c) : accept.mutate(c))}>
                            Подтвердить
                          </FinButton>
                        </span>
                      )
                    ) : (
                      <span className="text-[13px] text-p-muted">
                        {c.status === 'accepted' ? 'Подтвердил' : 'Оставил график без изменений'} {c.resolved_by ?? '—'}, {dateTime(c.resolved_at)}
                        {c.schedule_item_id && <span className="block">платёж перенесён</span>}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </FinTable>
        </FinCard>

        {data && (data.total ?? 0) > 100 && <div className="flex items-center justify-between gap-3 text-sm"><span>Показаны {offset + 1}–{offset + data.changes.length} из {data.total}</span><div className="flex gap-2"><FinButton disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>Назад</FinButton><FinButton disabled={offset + data.changes.length >= (data.total ?? 0)} onClick={() => setOffset(offset + 100)}>Вперёд</FinButton></div></div>}
        <FinCard title="Оплаты без чека" meta={data ? plural(data.no_receipt.length, ['оплата', 'оплаты', 'оплат']) : undefined}>
          <FinTable minWidth={820}>
            <thead><tr><Th>Дата оплаты</Th><Th>Ученик</Th><Th>За что</Th><Th>Способ</Th><Th right>Сумма</Th><Th>Отметил</Th><Th right>Действие</Th></tr></thead>
            <tbody>
              {data && data.no_receipt.length === 0 && <EmptyRow colSpan={7}>У всех оплат есть чек</EmptyRow>}
              {data?.no_receipt.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap">{date(p.paid_at)}</Td>
                  <Td><StudentCell name={p.student_name} onOpen={() => navigate(`/finance/contracts/${p.contract_id}`)} /></Td>
                  <Td>{paymentTitle(p)}</Td>
                  <Td>{p.method ? METHOD_LABELS[p.method] : '—'}</Td>
                  <Td right className="font-semibold">{money(p.amount, p.currency)}</Td>
                  <Td className="whitespace-nowrap text-[13px] text-p-muted">{p.recorded_by ?? '—'}</Td>
                  <Td right>{canManage && <AttachReceiptButton paymentId={p.id} label="Прикрепить чек" />}</Td>
                </tr>
              ))}
            </tbody>
          </FinTable>
        </FinCard>

      </div>
      <ConfirmChangeDialog change={confirming} onClose={() => setConfirming(null)} />
    </div>
  )
}
