import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type ScheduleItem } from '@/api/finance'
import {
  EmptyRow, FinAlert, FinBadge, FinButton, FinCard, FinPageHeader, FinTable, StudentCell, Td, Th,
} from '@/components/finance/ui'
import { PayDialog } from '@/components/finance/dialogs'
import { METHOD_LABELS, date, dateTime, money, num, parseIso, paymentTitle, payments, plural } from '@/components/finance/format'

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
const MONTHS = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

/**
 * «Сегодня» — список дел, а не сводка: что оплатить отметить, кто просрочил,
 * что поменяли в Notion. Подробности — в «Платежах» и «Проверке».
 */
export function FinanceTodayPage() {
  const { can } = useAuth()
  const canManage = can('finance_desk', 'manage')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.today(),
    queryFn: financeApi.today,
    refetchInterval: 60_000,
  })
  const importNotion = useMutation({
    mutationFn: financeApi.notionImport,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: financeKeys.all })
      toast({ title: `Перенесено в график: ${plural(res.created, ['договор', 'договора', 'договоров'])}` })
    },
    onError: (err) => toast({ title: 'Не перенесено', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const open = (contractId: string) => navigate(`/finance/contracts/${contractId}`)
  const waiting = data?.due_today.filter((i) => i.state !== 'paid') ?? []
  const waitingSum = waiting.reduce((s, i) => s + num(i.left), 0)
  const day = data ? parseIso(data.today) : null

  return (
    <div>
      <FinPageHeader
        title="Сегодня"
        description={day && data ? `${WEEKDAYS[day.getDay()]}, ${date(data.today)}. Поступило в ${MONTHS[day.getMonth()]}: ${money(data.month_received)} из ${money(data.month_planned)} по графику.` : undefined}
        actions={canManage && waiting.length > 0 && (
          <FinButton variant="primary" onClick={() => setPaying(waiting[0])}>Отметить оплату</FinButton>
        )}
      />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {isLoading && <p className="text-p-muted">Загрузка…</p>}

      {data && data.notion_import_count > 0 && canManage && (
        <FinAlert action={
          <FinButton size="sm" variant="primary" disabled={importNotion.isPending} onClick={() => importNotion.mutate()}>
            {importNotion.isPending ? 'Переносим…' : 'Перенести в график'}
          </FinButton>
        }>
          В Notion указаны остаток и дата оплаты по {plural(data.notion_import_count, ['договору', 'договорам', 'договорам'])}, у которых ещё нет графика платежей.
          Перенести их как первый платёж? Сумму и дату потом можно поправить.
        </FinAlert>
      )}

      {data && (
        <div className="grid gap-5">
          <FinCard title="Оплаты на сегодня" meta={waiting.length ? `ждём ${payments(waiting.length)} на ${money(waitingSum)}` : undefined}>
            <FinTable minWidth={680}>
              <thead><tr><Th>Ученик</Th><Th>За что</Th><Th right>Сумма</Th><Th right> </Th></tr></thead>
              <tbody>
                {data.due_today.length === 0 && <EmptyRow colSpan={4}>На сегодня платежей по графику нет</EmptyRow>}
                {data.due_today.map((i) => (
                  <tr key={i.id}>
                    <Td><StudentCell name={i.student_name} sub={i.mzk_name ? `МЗК ${i.mzk_name}` : 'МЗК не указан'} onOpen={() => open(i.contract_id)} /></Td>
                    <Td>{paymentTitle(i)}</Td>
                    <Td right className="font-semibold">{money(i.state === 'paid' ? i.amount : i.left)}</Td>
                    <Td right>
                      {i.state === 'paid' ? (
                        <span className="inline-flex items-center gap-2">
                          <FinBadge tone="ok">Оплачено{i.method ? ` · ${METHOD_LABELS[i.method]}` : ''}</FinBadge>
                          {i.has_receipt === false && <FinBadge tone="yellow">Нет чека</FinBadge>}
                        </span>
                      ) : canManage ? (
                        <FinButton size="sm" onClick={() => setPaying(i)}>Отметить оплату</FinButton>
                      ) : <FinBadge tone="yellow">Ждём</FinBadge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
          </FinCard>

          <FinCard
            title="Просрочено"
            meta={data.overdue_count ? `${payments(data.overdue_count)} на ${money(data.overdue_total)}` : undefined}
            actions={data.overdue_count > data.overdue.length && (
              <Link to="/finance/payments?tab=overdue" className="text-sm font-semibold text-p-text underline">Все просроченные</Link>
            )}
          >
            <FinTable minWidth={680}>
              <thead><tr><Th>Ученик</Th><Th>Срок оплаты</Th><Th right>Просрочка</Th><Th right>Сумма</Th></tr></thead>
              <tbody>
                {data.overdue.length === 0 && <EmptyRow colSpan={4}>Просроченных платежей нет</EmptyRow>}
                {data.overdue.map((i) => (
                  <tr key={i.id}>
                    <Td><StudentCell name={i.student_name} sub={i.mzk_name ? `МЗК ${i.mzk_name}` : 'МЗК не указан'} onOpen={() => open(i.contract_id)} /></Td>
                    <Td className="whitespace-nowrap">{date(i.due_date)}</Td>
                    <Td right><FinBadge tone="bad">{plural(i.days_overdue, ['день', 'дня', 'дней'])}</FinBadge></Td>
                    <Td right className="font-semibold">{money(i.left)}</Td>
                  </tr>
                ))}
              </tbody>
            </FinTable>
          </FinCard>

          <FinCard
            title="Изменения сумм и дат"
            meta={data.changes_count ? `ждут проверки: ${data.changes_count}` : 'всё проверено'}
            actions={data.changes_count > 0 && (
              <Link to="/finance/review" className="text-sm font-semibold text-p-text underline">Проверить</Link>
            )}
          >
            {data.changes.length === 0 ? (
              <p className="px-5 py-8 text-center text-p-muted">Новых изменений сумм и дат нет</p>
            ) : (
              <ul className="divide-y divide-[var(--fin-line-soft)]">
                {data.changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <StudentCell name={c.student_name} onOpen={c.contract_id ? () => open(c.contract_id!) : undefined} />
                      <div className="text-[var(--fin-text-3)]">
                        {c.field_label}: <span className="line-through">{c.old_label}</span> → <span className="font-semibold text-p-text">{c.new_label}</span>
                      </div>
                    </div>
                    <span className="text-[13px] text-p-muted">{dateTime(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </FinCard>
        </div>
      )}
      <PayDialog item={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
