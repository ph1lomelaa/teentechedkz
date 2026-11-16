/**
 * Полные списки платежей для раскрывающихся блоков на «Сегодня»: просрочено,
 * ожидаются (списком и календарём), поступили. Бывшая страница «Платежи»
 * убрана 09.11.2026 — она повторяла «Сегодня». Каждый список рисует только
 * содержимое карточки (фильтры, таблица, экспорт); заголовок и кнопку
 * «Свернуть» даёт блок, в который список вставлен.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { financeApi, financeKeys, type OfferDue, type ReceivedPayment, type ScheduleItem } from '@/api/finance'
import { FinBadge, FinButton, ItemStatus, StudentCell } from './ui'
import { NotionTable } from './NotionTable'
import { AttachReceiptButton } from './dialogs'
import {
  METHOD_LABELS, addDays, date, dateTime, localIso, money, moneyTotals, num, parseIso, paymentTitle, payments, plural, statusLabel,
} from './format'

const PERIOD_OPTS = [['month', 'Этот месяц'], ['prev', 'Прошлый месяц'], ['week', 'Последние 7 дней'], ['custom', 'Свой период']] as const
const CTRL = 'h-8 rounded-ctl border border-p-line bg-p-panel px-2 text-sm text-p-text'
const MONTH = (iso: string) => {
  const d = parseIso(iso)
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '').replace(/^./, (c) => c.toUpperCase())
}
// Группа «Месяц» идёт по дате (2026-11 раньше 2026-12), а не по названию.
const monthKey = (i: ScheduleItem, group: string) => group === 'Месяц' && i.due_date ? i.due_date.slice(0, 7) : undefined
const AGE_BUCKET = (days: number) => days <= 30 ? 'До 30 дней' : days <= 60 ? '31–60 дней' : 'Более 60 дней'

type ListProps = { canManage: boolean; onPay: (i: ScheduleItem) => void }

// Общие поля строки графика (ожидаются и просрочено).
function itemValues(i: ScheduleItem, field: string): string[] {
  if (field === 'МЗК') return i.mzk_name ? [i.mzk_name] : []
  if (field === 'За что') return [paymentTitle(i)]
  // В списках только строки со сроком: «после оффера» без даты сюда не попадают.
  if (field === 'Срок оплаты') return i.due_date ? [i.due_date] : []
  if (field === 'Месяц') return i.due_date ? [MONTH(i.due_date)] : []
  if (field === 'Сумма') return [String(num(i.left))]
  if (field === 'Просрочка, дн.') return [String(i.days_overdue)]
  if (field === 'Срок долга') return [AGE_BUCKET(i.days_overdue)]
  if (field === 'Напоминали МЗК') return i.reminded_at ? [i.reminded_at.slice(0, 10)] : ['Не отправлялось']
  if (field === 'Статус договора') return i.pipeline_status ? [statusLabel(i.pipeline_status)] : []
  return []
}

function itemExport(i: ScheduleItem, field: string): string {
  if (field === 'Срок оплаты') return date(i.due_date)
  if (field === 'Сумма') return money(i.left, i.currency)
  if (field === 'Напоминали МЗК') return i.reminded_at ? dateTime(i.reminded_at) : ''
  return itemValues(i, field).join(', ')
}

// ---------------------------------------------------------------- Ожидаются

export function ExpectedList({ canManage, onPay, extraControls }: ListProps & { extraControls?: ReactNode }) {
  const navigate = useNavigate()
  const today = localIso()
  const monthEnd = localIso(new Date(parseIso(today).getFullYear(), parseIso(today).getMonth() + 1, 0))
  const { data, isPending, error, refetch } = useQuery({ queryKey: financeKeys.expected(), queryFn: financeApi.expected })
  return (
    <NotionTable<ScheduleItem>
      rows={data} loading={isPending} error={error} onRetry={() => refetch()}
      rowKey={i => i.id}
      title={{ field: 'Ученик', text: i => i.student_name, onOpen: i => navigate(`/finance/contracts/${i.contract_id}`) }}
      base={['МЗК', 'За что', 'Срок оплаты', 'Сумма']}
      extra={['Месяц', 'Статус договора']}
      numeric={['Сумма']} dates={['Срок оплаты']}
      values={itemValues}
      cell={(i, field) => {
        if (field === 'Срок оплаты') return <span className="whitespace-nowrap">{date(i.due_date)}{i.due_date === today && <span className="ml-2"><FinBadge tone="yellow">сегодня</FinBadge></span>}</span>
        if (field === 'Сумма') return <span className="font-semibold">{money(i.left, i.currency)}</span>
        return undefined
      }}
      action={canManage ? (i => <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>) : undefined}
      quick={[
        { key: 'today', label: 'Сегодня', test: i => i.due_date === today },
        { key: 'week', label: 'Ближайшие 7 дней', test: i => !!i.due_date && i.due_date <= addDays(today, 6) },
        { key: 'month', label: 'До конца месяца', test: i => !!i.due_date && i.due_date <= monthEnd },
      ]}
      extraControls={extraControls}
      groupFields={['МЗК', 'Месяц', 'Статус договора']} defaultGroup="Месяц"
      groupSortKey={monthKey}
      defaultSort={{ field: 'Срок оплаты', direction: 'asc' }}
      searchText={i => [i.student_name, i.mzk_name ?? '']}
      storageKey="finance-expected-fields" countLabel="Платежей"
      summary={rows => moneyTotals(rows)}
      exportName={`ожидаются-${today}`} exportValue={itemExport}
      empty="Ожидаемых платежей нет."
    />
  )
}

// ---------------------------------------------------------------- Просрочено

export function OverdueList({ canManage, onPay }: ListProps) {
  const navigate = useNavigate()
  const { data, isPending, error, refetch } = useQuery({ queryKey: financeKeys.overdue(), queryFn: financeApi.overdue })
  return (
    <NotionTable<ScheduleItem>
      rows={data} loading={isPending} error={error} onRetry={() => refetch()}
      rowKey={i => i.id}
      title={{ field: 'Ученик', text: i => i.student_name, onOpen: i => navigate(`/finance/contracts/${i.contract_id}`) }}
      base={['МЗК', 'За что', 'Срок оплаты', 'Просрочка, дн.', 'Сумма', 'Напоминали МЗК']}
      extra={['Срок долга', 'Статус договора', 'Месяц']}
      numeric={['Сумма', 'Просрочка, дн.']} dates={['Срок оплаты']}
      values={itemValues}
      cell={(i, field) => {
        if (field === 'Срок оплаты') return date(i.due_date)
        if (field === 'Просрочка, дн.') return <FinBadge tone="bad">{plural(i.days_overdue, ['день', 'дня', 'дней'])}</FinBadge>
        if (field === 'Сумма') return <span className="font-semibold">{money(i.left, i.currency)}</span>
        if (field === 'Напоминали МЗК') return i.reminded_at ? dateTime(i.reminded_at) : <span className="text-p-muted2">Не отправлялось</span>
        return undefined
      }}
      action={canManage ? (i => <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>) : undefined}
      quick={[
        { key: 'b30', label: 'До 30 дней', test: i => i.days_overdue <= 30 },
        { key: 'b60', label: '31–60 дней', test: i => i.days_overdue > 30 && i.days_overdue <= 60 },
        { key: 'b61', label: 'Более 60 дней', test: i => i.days_overdue > 60 },
        { key: 'no_mzk', label: 'МЗК не указан', test: i => !i.mzk_name },
      ]}
      groupFields={['МЗК', 'Срок долга', 'Статус договора']}
      groupSortKey={monthKey}
      defaultSort={{ field: 'Просрочка, дн.', direction: 'desc' }}
      searchText={i => [i.student_name, i.mzk_name ?? '']}
      storageKey="finance-overdue-fields" countLabel="Платежей"
      summary={rows => moneyTotals(rows)}
      exportName={`просрочены-${localIso()}`} exportValue={itemExport}
      empty="Просроченных платежей нет."
    />
  )
}

// ---------------------------------------------------------------- Оффер получен

function offerValues(o: OfferDue, field: string): string[] {
  if (field === 'Вуз') return [o.university]
  if (field === 'Оффер от') return o.offer_at ? [o.offer_at.slice(0, 10)] : []
  if (field === 'Договор') return o.amount ? [String(num(o.amount))] : []
  if (field === 'Оплачено') return o.paid ? [String(num(o.paid))] : []
  if (field === 'Остаток') return [String(num(o.remaining))]
  if (field === 'Дата оплаты') return o.remaining_date ? [o.remaining_date] : []
  if (field === 'Итог') return [o.enrolled ? 'Зачислен' : 'Оффер']
  return []
}

/** Ученики с оффером, у которых по договору ещё остаток. Уходят сами, когда остаток 0. */
export function OffersList({ rows, loading, error, onRetry }: { rows?: OfferDue[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const navigate = useNavigate()
  return (
    <NotionTable<OfferDue>
      rows={rows} loading={loading} error={error} onRetry={onRetry}
      rowKey={o => o.contract_id}
      title={{ field: 'Ученик', text: o => o.student_name, onOpen: o => navigate(`/finance/contracts/${o.contract_id}`), notion: o => o.notion_url }}
      base={['Вуз', 'Оффер от', 'Оплачено', 'Остаток']}
      extra={['Договор', 'Дата оплаты', 'Итог']}
      numeric={['Договор', 'Оплачено', 'Остаток']} dates={['Оффер от', 'Дата оплаты']}
      values={offerValues}
      cell={(o, field) => {
        if (field === 'Вуз') return <span>{o.university}{o.offers > 1 && <span className="ml-2 text-p-muted2">+{o.offers - 1}</span>}{o.enrolled && <span className="ml-2"><FinBadge tone="neutral">зачислен</FinBadge></span>}</span>
        if (field === 'Оффер от') return o.offer_at ? <span className="whitespace-nowrap">{date(o.offer_at.slice(0, 10))}</span> : <span className="text-p-muted2">раньше</span>
        if (field === 'Договор') return o.amount ? money(o.amount, o.currency) : '—'
        if (field === 'Оплачено') return o.paid ? money(o.paid, o.currency) : '—'
        if (field === 'Остаток') return (
          <span className="inline-flex flex-col items-end">
            <span className="font-semibold">{money(o.remaining, o.currency)}</span>
            {o.by_payments != null && (
              <span className="whitespace-nowrap text-xs text-p-muted">
                В Notion остаток {money(o.remaining, o.currency)}, по оплатам {money(o.by_payments, o.currency)}
              </span>
            )}
          </span>
        )
        if (field === 'Дата оплаты') return o.remaining_date ? date(o.remaining_date) : '—'
        return undefined
      }}
      action={o => <FinButton size="sm" onClick={() => navigate(`/finance/contracts/${o.contract_id}`)}>Открыть договор</FinButton>}
      quick={[
        { key: 'week', label: 'Оффер за 7 дней', test: o => !!o.offer_at && o.offer_at.slice(0, 10) >= addDays(localIso(), -6) },
        { key: 'no_date', label: 'Без даты оплаты', test: o => !o.remaining_date },
        { key: 'mismatch', label: 'Не сходится с Notion', test: o => o.by_payments != null },
      ]}
      groupFields={['Итог']}
      defaultSort={{ field: 'Оффер от', direction: 'desc' }}
      searchText={o => [o.student_name, o.university]}
      storageKey="finance-offers-fields" countLabel="Учеников"
      summary={rows => moneyTotals(rows.map(o => ({ amount: o.remaining, currency: o.currency })))}
      exportName={`оффер-остаток-${localIso()}`} exportValue={(o, field) => field === 'Остаток' ? money(o.remaining, o.currency) : offerValues(o, field).join(', ')}
      empty="Учеников с оффером и неоплаченным остатком нет."
    />
  )
}

// ---------------------------------------------------------------- Поступили

type Period = typeof PERIOD_OPTS[number][0]

function periodRange(p: Period, from: string, to: string): [string, string] {
  const today = localIso()
  const d = parseIso(today)
  if (p === 'week') return [addDays(today, -6), today]
  if (p === 'prev') return [localIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), localIso(new Date(d.getFullYear(), d.getMonth(), 0))]
  if (p === 'custom') return [from || today, to || today]
  return [localIso(new Date(d.getFullYear(), d.getMonth(), 1)), today]
}

const receivedValues = (p: ReceivedPayment, field: string): string[] => {
  if (field === 'Дата оплаты') return p.paid_at ? [p.paid_at.slice(0, 10)] : []
  if (field === 'За что') return [paymentTitle(p)]
  if (field === 'Способ') return p.method ? [METHOD_LABELS[p.method]] : []
  if (field === 'Сумма') return [String(num(p.amount))]
  if (field === 'Чек') return [p.has_receipt ? 'Есть' : 'Нет чека']
  if (field === 'Отметил') return p.recorded_by ? [p.recorded_by] : []
  return []
}

export function ReceivedList({ canManage }: { canManage: boolean }) {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState(addDays(localIso(), -30))
  const [customTo, setCustomTo] = useState(localIso())
  const [from, to] = periodRange(period, customFrom, customTo)
  const { data, isPending, error, refetch } = useQuery({
    queryKey: financeKeys.received(from, to),
    queryFn: () => financeApi.received(from, to),
  })
  const periodControls = <>
    <select aria-label="Период" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={CTRL}>
      {PERIOD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
    {period === 'custom' && <>
      <input type="date" aria-label="С" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className={CTRL} />
      <input type="date" aria-label="По" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className={CTRL} />
    </>}
  </>
  return (
    <NotionTable<ReceivedPayment>
      rows={data} loading={isPending} error={error} onRetry={() => refetch()}
      rowKey={p => p.id}
      title={{ field: 'Ученик', text: p => p.student_name, onOpen: p => navigate(`/finance/contracts/${p.contract_id}`) }}
      base={['Дата оплаты', 'За что', 'Способ', 'Сумма', 'Чек', 'Отметил']}
      numeric={['Сумма']} dates={['Дата оплаты']}
      values={receivedValues}
      cell={(p, field) => {
        if (field === 'Дата оплаты') return date(p.paid_at)
        if (field === 'Сумма') return <span className="font-semibold">{money(p.amount, p.currency)}</span>
        if (field === 'Чек') return p.has_receipt ? <FinBadge tone="neutral">Есть</FinBadge> : (
          <span className="inline-flex items-center gap-2"><FinBadge tone="yellow">Нет чека</FinBadge>{canManage && <AttachReceiptButton paymentId={p.id} />}</span>
        )
        return undefined
      }}
      quick={[
        { key: 'no_receipt', label: 'Без чека', test: p => !p.has_receipt },
        { key: 'kaspi', label: METHOD_LABELS.kaspi, test: p => p.method === 'kaspi' },
        { key: 'bank', label: METHOD_LABELS.bank, test: p => p.method === 'bank' },
        { key: 'cash', label: METHOD_LABELS.cash, test: p => p.method === 'cash' },
      ]}
      extraControls={periodControls}
      groupFields={['Способ', 'Чек', 'Отметил']}
      defaultSort={{ field: 'Дата оплаты', direction: 'desc' }}
      searchText={p => [p.student_name, p.recorded_by ?? '']}
      storageKey="finance-received-fields" countLabel="Оплат"
      summary={rows => moneyTotals(rows, 'amount')}
      exportName={`поступили-${from}-${to}`}
      exportValue={(p, f) => f === 'Сумма' ? money(p.amount, p.currency) : f === 'Дата оплаты' ? date(p.paid_at) : receivedValues(p, f).join(', ')}
      empty="За период оплат нет."
    />
  )
}

// ---------------------------------------------------------------- Календарь

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function PaymentsCalendar({ canManage, onPay }: ListProps) {
  const navigate = useNavigate()
  const today = localIso()
  const [cursor, setCursor] = useState(() => ({ y: parseIso(today).getFullYear(), m: parseIso(today).getMonth() }))
  const [picked, setPicked] = useState(today)
  const first = new Date(cursor.y, cursor.m, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => new Date(cursor.y, cursor.m, i - offset + 1))
  const monthFrom = localIso(first)
  const monthTo = localIso(new Date(cursor.y, cursor.m + 1, 0))
  const gridFrom = localIso(cells[0])
  const gridTo = localIso(cells[cells.length - 1])
  const { data: items = [] } = useQuery({ queryKey: financeKeys.schedule(gridFrom, gridTo), queryFn: () => financeApi.schedule(gridFrom, gridTo) })
  const { data: received = [] } = useQuery({ queryKey: financeKeys.received(gridFrom, gridTo), queryFn: () => financeApi.received(gridFrom, gridTo) })

  const byDay = useMemo(() => {
    const map = new Map<string, { got: number; wait: number; late: number; items: ScheduleItem[]; payments: ReceivedPayment[] }>()
    const at = (k: string) => map.get(k) ?? map.set(k, { got: 0, wait: 0, late: 0, items: [], payments: [] }).get(k)!
    items.forEach((i) => {
      if (!i.due_date) return
      const d = at(i.due_date)
      d.items.push(i)
      if (i.state === 'overdue') d.late += num(i.left)
      else if (i.state !== 'paid') d.wait += num(i.left)
    })
    received.forEach((p) => { if (p.paid_at) { const d = at(p.paid_at); d.got += num(p.amount); d.payments.push(p) } })
    return map
  }, [items, received])

  const inMonth = (iso: string | null) => !!iso && iso >= monthFrom && iso <= monthTo
  const plan = moneyTotals(items.filter((i) => inMonth(i.due_date)), 'amount')
  const got = moneyTotals(received.filter((p) => p.paid_at && inMonth(p.paid_at)), 'amount')
  const wait = moneyTotals(items.filter((i) => inMonth(i.due_date) && i.state !== 'paid'))
  const day = byDay.get(picked)
  const shift = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
    setPicked(localIso(d) <= today && today <= localIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) ? today : localIso(d))
  }
  const monthTitle = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()).replace(' г.', '')

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 border-b border-p-line px-5 py-3">
          <span className="font-bold text-p-text">{monthTitle}</span>
          <span className="flex gap-2">
            <FinButton size="sm" aria-label="Предыдущий месяц" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></FinButton>
            <FinButton size="sm" aria-label="Следующий месяц" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></FinButton>
          </span>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[680px] grid-cols-7">
            {WEEK.map((w, i) => (
              <div key={w} className={cn('border-b border-p-line bg-[var(--fin-head)] px-3 py-2 text-[13px] font-semibold text-p-muted', i >= 5 && 'bg-[#F3F2EE]')}>{w}</div>
            ))}
            {cells.map((d, i) => {
              const iso = localIso(d)
              const v = byDay.get(iso)
              const outside = d.getMonth() !== cursor.m
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setPicked(iso)}
                  aria-pressed={picked === iso}
                  aria-label={`${date(iso)}: поступило ${moneyTotals(v?.payments ?? [], 'amount')}, ожидается ${moneyTotals(v?.items.filter(i => i.state !== 'paid' && i.state !== 'overdue') ?? [])}, просрочено ${moneyTotals(v?.items.filter(i => i.state === 'overdue') ?? [])}`}
                  className={cn(
                    'flex min-h-[88px] flex-col gap-0.5 border-b border-r border-[var(--fin-line-soft)] px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--fin-head)]',
                    i % 7 >= 5 && 'bg-[#FBFAF7]',
                    outside && 'text-[var(--fin-text-3)] opacity-60',
                    picked === iso && 'outline outline-2 -outline-offset-2 outline-black',
                  )}
                >
                  <span className={cn('mb-1 grid h-6 w-6 place-items-center rounded-full text-[13px] font-semibold', iso === today && 'bg-brand text-black')}>{d.getDate()}</span>
                  {!!v?.got && <span className="truncate font-semibold text-[var(--fin-ok)]">+{moneyTotals(v.payments, 'amount')}</span>}
                  {!!v?.wait && <span className="truncate font-semibold text-p-text">{moneyTotals(v.items.filter(i => i.state !== 'paid' && i.state !== 'overdue'))}</span>}
                  {!!v?.late && <span className="truncate font-semibold text-[var(--fin-bad)]">{moneyTotals(v.items.filter(i => i.state === 'overdue'))}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-3 text-sm">
          {[['План', plan, ''], ['Поступило', got, 'text-[var(--fin-ok)]'], ['Ожидается', wait, '']].map(([l, v, c]) => (
            <div key={l} className="border-r border-p-line px-5 py-3 last:border-r-0">
              <div className="text-[13px] text-p-muted">{l}</div>
              <div className={cn('font-bold', c)}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 border-t border-p-line xl:border-l xl:border-t-0">
        <div className="flex items-baseline gap-3 border-b border-p-line px-5 py-3">
          <span className="font-bold text-p-text">{date(picked)}</span>
          {day && <span className="text-[13px] text-p-muted">{payments(day.items.length)}</span>}
        </div>
        {!day || (day.items.length === 0 && day.payments.length === 0) ? (
          <p className="px-5 py-10 text-center text-sm text-p-muted">В этот день платежей нет</p>
        ) : (
          <ul className="divide-y divide-[var(--fin-line-soft)]">
            {day.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <StudentCell name={i.student_name} sub={paymentTitle(i)} onOpen={() => navigate(`/finance/contracts/${i.contract_id}`)} />
                  <div className="mt-1"><ItemStatus item={i} today={today} /></div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="font-semibold">{money(i.state === 'paid' ? i.amount : i.left, i.currency)}</span>
                  {canManage && i.state !== 'paid' && <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>}
                </div>
              </li>
            ))}
            {day.payments.filter((p) => !day.items.some((i) => i.id === p.schedule_item_id)).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <StudentCell name={p.student_name} sub={`Поступило · ${paymentTitle(p)}`} />
                <span className="font-semibold text-[var(--fin-ok)]">+{money(p.amount, p.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
