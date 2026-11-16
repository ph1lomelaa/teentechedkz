import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useFinanceMode } from '@/components/finance/useFinanceMode'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type DebtRow, type ScheduleItem } from '@/api/finance'
import { FinBadge, FinButton, FinField, FinInput, FinModal, FinPageHeader, FinSelect, MoneyInput } from '@/components/finance/ui'
import { NotionTable } from '@/components/finance/NotionTable'
import { PayDialog } from '@/components/finance/dialogs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover'
import { date, dateTime, localIso, money, num, parseAmountInput, paymentTitle, plural } from '@/components/finance/format'

type Mode = 'contact' | 'promise' | 'escalated' | 'reschedule' | 'mzk'
const TITLES: Record<Mode, string> = {
  contact: 'Записать контакт',
  promise: 'Обещали оплатить',
  escalated: 'Передать руководителю',
  reschedule: 'Перенести срок по согласованию',
  mzk: 'Ответ на напоминание',
}
const MENU = 'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--fin-head)]'

function DebtDialog({ row, mode, onClose }: { row: DebtRow | null; mode: Mode; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState('call')
  const [withWhom, setWithWhom] = useState('')
  const [result, setResult] = useState('')
  const [day, setDay] = useState(localIso())
  const [amount, setAmount] = useState('')
  const [answer, setAnswer] = useState<'promised' | 'no_answer' | 'refund'>('promised')
  useEffect(() => { setChannel('call'); setWithWhom(''); setResult(''); setDay(localIso()); setAmount(''); setAnswer('promised') }, [row, mode])

  const save = useMutation({
    mutationFn: () => {
      const value = parseAmountInput(amount)
      if (mode === 'mzk') {
        return financeApi.mzkReply(row!.id, { answer, promise_date: answer === 'promised' ? day : null,
          promise_amount: answer === 'promised' && value > 0 ? String(value) : null, note: result.trim() || null })
      }
      return financeApi.debtAction(row!.id, {
        kind: mode, channel: mode === 'contact' ? channel : null, with_whom: withWhom.trim() || null, result: result.trim() || null,
        promise_date: mode === 'promise' ? day : null, promise_amount: mode === 'promise' && value > 0 ? String(value) : null,
        new_due: mode === 'reschedule' ? day : null,
      })
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: financeKeys.all }); toast({ title: 'Записано' }); onClose() },
    onError: (err) => toast({ title: 'Не записано', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const needsDay = mode === 'promise' || mode === 'reschedule' || (mode === 'mzk' && answer === 'promised')
  const invalid = (needsDay && !day) || (mode === 'reschedule' && !result.trim())

  return (
    <FinModal open={!!row} onClose={onClose} title={TITLES[mode]}
      context={row ? `${row.student_name} · ${paymentTitle(row)} · ${money(row.left, row.currency)}, просрочка ${plural(row.days_overdue, ['день', 'дня', 'дней'])}` : undefined}
      footer={<><FinButton onClick={onClose}>Отмена</FinButton><FinButton variant="primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>Записать</FinButton></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mode === 'mzk' && (
          <FinField label="Результат" wide htmlFor="debt-answer">
            <FinSelect id="debt-answer" value={answer} onChange={(e) => setAnswer(e.target.value as typeof answer)}>
              <option value="promised">Связался, обещали оплатить</option>
              <option value="no_answer">Не дозвонился</option>
              <option value="refund">Клиент хочет вернуть деньги</option>
            </FinSelect>
          </FinField>
        )}
        {mode === 'contact' && <>
          <FinField label="Как связались" htmlFor="debt-channel">
            <FinSelect id="debt-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="call">Звонок</option><option value="message">Сообщение</option><option value="meeting">Встреча</option>
            </FinSelect>
          </FinField>
          <FinField label="С кем" htmlFor="debt-who"><FinInput id="debt-who" value={withWhom} onChange={(e) => setWithWhom(e.target.value)} placeholder="Например: мама ученика" /></FinField>
        </>}
        {needsDay && (
          <FinField label={mode === 'reschedule' ? 'Новый срок' : 'Обещали оплатить до'} required htmlFor="debt-day">
            <FinInput id="debt-day" type="date" min={localIso()} value={day} onChange={(e) => setDay(e.target.value)} />
          </FinField>
        )}
        {(mode === 'promise' || (mode === 'mzk' && answer === 'promised')) && (
          <FinField label="Сумма, ₸" htmlFor="debt-amount"><MoneyInput id="debt-amount" value={amount} onChange={setAmount} /></FinField>
        )}
        <FinField label={mode === 'reschedule' ? 'С кем согласовано' : mode === 'escalated' ? 'Что нужно решить' : 'Итог, комментарий'}
          required={mode === 'reschedule'} wide htmlFor="debt-result">
          <FinInput id="debt-result" value={result} maxLength={1000} onChange={(e) => setResult(e.target.value)} />
        </FinField>
      </div>
    </FinModal>
  )
}

/**
 * «Долги» (задание 8): все просроченные платежи — кто работает с долгом, что
 * уже сделано и что дальше. МЗК отвечает здесь на напоминание по своим клиентам.
 */
export function FinanceDebtsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { canEdit: canManage } = useFinanceMode()
  const isMzk = user?.role === 'mzk_manager'
  const [params] = useSearchParams()
  const [dialog, setDialog] = useState<{ row: DebtRow; mode: Mode } | null>(null)
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: [...financeKeys.all, 'debts'], queryFn: financeApi.debts })
  const remind = useMutation({
    mutationFn: (r: DebtRow) => financeApi.remind(r.id),
    onSuccess: (res) => { queryClient.invalidateQueries({ queryKey: financeKeys.all }); toast({ title: res.already_sent ? 'Сегодня МЗК уже напоминали' : 'Напоминание отправлено МЗК' }) },
    onError: (err) => toast({ title: 'Напоминание не отправлено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const focus = params.get('item')

  return (
    <div>
      <FinPageHeader title="Долги" description="Просроченные платежи: этап, последнее действие, обещание и кто ведёт долг. Клиенту автоматически ничего не отправляется." />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {data && data.stages.length > 0 && (
        <dl className="mb-5 flex flex-wrap gap-x-10 gap-y-3 border-b border-p-line pb-4">
          {data.stages.map((s) => (
            <div key={s.stage}><dt className="text-[13px] text-p-muted">{s.stage}</dt>
              <dd className="text-base font-semibold">{plural(s.count, ['платёж', 'платежа', 'платежей'])} на {money(s.total)}</dd></div>
          ))}
        </dl>
      )}
      <NotionTable<DebtRow>
        rows={data?.items}
        loading={isPending}
        error={error}
        onRetry={() => refetch()}
        rowKey={(r) => r.id}
        title={{ field: 'Ученик', text: (r) => r.student_name, onOpen: (r) => navigate(`/finance/contracts/${r.contract_id}`), notion: (r) => r.notion_url }}
        base={['МЗК', 'Услуга', 'Сумма', 'Дней', 'Этап', 'Последнее действие', 'Обещали оплатить', 'Ответственный']}
        extra={['Срок оплаты']}
        numeric={['Сумма', 'Дней']}
        dates={['Срок оплаты']}
        values={(r, f) => {
          if (f === 'МЗК') return r.mzk_name ? [r.mzk_name] : []
          if (f === 'Услуга') return [paymentTitle(r)]
          if (f === 'Сумма') return [String(num(r.left))]
          if (f === 'Дней') return [String(r.days_overdue)]
          if (f === 'Этап') return [r.stage]
          if (f === 'Последнее действие') return r.last_action ? [r.last_action.label] : ['Ничего не делали']
          if (f === 'Обещали оплатить') return r.promise?.promise_date ? [r.promise.promise_date] : r.promise_broken ? ['Обещание нарушено'] : []
          if (f === 'Ответственный') return [r.responsible]
          if (f === 'Срок оплаты') return r.due_date ? [r.due_date] : []
          return []
        }}
        cell={(r, f) => {
          if (f === 'Сумма') return <span className="font-semibold">{money(r.left, r.currency)}</span>
          if (f === 'Дней') return <FinBadge tone="bad">{r.days_overdue}</FinBadge>
          if (f === 'Последнее действие') return r.last_action
            ? <span className="block max-w-[320px] whitespace-normal"><span>{r.last_action.text}</span><span className="block text-xs text-p-muted">{dateTime(r.last_action.at)}{r.last_action.who ? ` · ${r.last_action.who}` : ''}</span></span>
            : <span className="text-p-muted2">—</span>
          if (f === 'Обещали оплатить') return r.promise?.promise_date
            ? <span>{date(r.promise.promise_date)}{r.promise.promise_amount ? ` · ${money(r.promise.promise_amount)}` : ''}</span>
            : r.promise_broken ? <span className="text-[var(--fin-bad)]">нарушено</span> : <span className="text-p-muted2">—</span>
          if (f === 'Срок оплаты') return date(r.due_date)
          return undefined
        }}
        action={(r) => (
          <span className="inline-flex items-center gap-2">
            {(isMzk && r.mine && r.awaiting_mzk) && <FinButton size="sm" variant="primary" onClick={() => setDialog({ row: r, mode: 'mzk' })}>Ответить</FinButton>}
            {canManage && <>
              <FinButton size="sm" onClick={() => setPaying(r)}>Отметить оплату</FinButton>
              <FinButton size="sm" onClick={() => setDialog({ row: r, mode: 'contact' })}>Записать контакт</FinButton>
              <Popover>
                <PopoverTrigger aria-label={`Действия по долгу: ${r.student_name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--fin-neutral-bg)]">
                  <MoreHorizontal className="h-4 w-4" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1">
                  <button type="button" className={MENU} onClick={() => setDialog({ row: r, mode: 'promise' })}>Обещали оплатить</button>
                  {r.mzk_name && <button type="button" className={MENU} disabled={remind.isPending} onClick={() => remind.mutate(r)}>Напомнить МЗК</button>}
                  {r.awaiting_mzk && <button type="button" className={MENU} onClick={() => setDialog({ row: r, mode: 'mzk' })}>Записать ответ МЗК</button>}
                  <button type="button" className={MENU} onClick={() => setDialog({ row: r, mode: 'escalated' })}>Передать руководителю</button>
                  <button type="button" className={MENU} onClick={() => setDialog({ row: r, mode: 'reschedule' })}>Перенести срок по согласованию</button>
                </PopoverContent>
              </Popover>
            </>}
          </span>
        )}
        exclusiveQuick
        quick={[
          { key: 'all', label: 'Все', test: () => true },
          { key: 'b30', label: 'До 30 дней', test: (r) => r.stage === 'до 30 дней' },
          { key: 'b60', label: '31–60 дней', test: (r) => r.stage === '31–60 дней' },
          { key: 'over', label: 'Более 60 дней', test: (r) => r.stage === 'более 60 дней' },
          { key: 'mzk', label: 'Ждут ответа МЗК', test: (r) => r.awaiting_mzk },
          { key: 'broken', label: 'Обещание нарушено', test: (r) => r.promise_broken },
          { key: 'mine', label: 'Мои клиенты', test: (r) => r.mine, hidden: !isMzk },
          { key: 'focus', label: 'Выбранный долг', test: (r) => r.id === focus, hidden: true },
        ]}
        initialQuick={[focus ? 'focus' : isMzk ? 'mine' : 'all']}
        groupFields={['Этап', 'МЗК', 'Ответственный']}
        defaultSort={{ field: 'Дней', direction: 'desc' }}
        searchText={(r) => [r.student_name, r.mzk_name ?? '']}
        storageKey="finance-debts-fields"
        countLabel="Долгов"
        totals={(rows) => ({ 'Сумма': money(rows.reduce((s, r) => s + num(r.left), 0)) })}
        exportName="долги"
        empty="Просроченных платежей нет."
      />
      {dialog && <DebtDialog row={dialog.row} mode={dialog.mode} onClose={() => setDialog(null)} />}
      <PayDialog item={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
