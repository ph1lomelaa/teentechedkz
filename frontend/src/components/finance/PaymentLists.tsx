/**
 * Полные списки платежей для раскрывающихся блоков на «Сегодня»: просрочено,
 * ожидаются (списком и календарём), поступили. Бывшая страница «Платежи»
 * убрана 09.11.2026 — она повторяла «Сегодня». Каждый список рисует только
 * содержимое карточки (фильтры, таблица, экспорт); заголовок и кнопку
 * «Свернуть» даёт блок, в который список вставлен.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { QueryError } from '@/components/shared/QueryState'
import { cn } from '@/lib/utils'
import { financeApi, financeKeys, type PaymentMethod, type ReceivedPayment, type ScheduleItem } from '@/api/finance'
import {
  EmptyRow, FinBadge, FinButton, FinFilterBar, FinInput, FinSelect, FinTable, ItemStatus, StudentCell, Td, Th, TotalRow,
} from './ui'
import { AttachReceiptButton } from './dialogs'
import {
  METHOD_LABELS, addDays, date, dateTime, downloadCsv, localIso, money, moneyTotals, num, parseIso, paymentTitle, payments, plural,
} from './format'

const paidCount = (n: number) => plural(n, ['оплата', 'оплаты', 'оплат'])

function SearchBox({ value, onChange, placeholder = 'Имя ученика' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="relative block w-56">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fin-text-3)]" />
      <FinInput value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </label>
  )
}

function MzkSelect({ items, value, onChange }: { items: { mzk_name: string | null }[]; value: string; onChange: (v: string) => void }) {
  const options = [...new Set(items.map((i) => i.mzk_name).filter(Boolean) as string[])].sort()
  return (
    <FinSelect aria-label="МЗК" value={value} onChange={(e) => onChange(e.target.value)} className="w-44">
      <option value="">Все МЗК</option>
      {options.map((m) => <option key={m} value={m}>{m}</option>)}
    </FinSelect>
  )
}

function ExportButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <FinButton disabled={disabled} onClick={onClick} title="Выгрузить то, что сейчас в списке, в таблицу CSV">
      <Download className="h-4 w-4" aria-hidden="true" />Экспорт
    </FinButton>
  )
}

const matches = (i: { student_name: string; mzk_name?: string | null }, q: string, mzk: string) =>
  (!q || i.student_name.toLowerCase().includes(q.toLowerCase())) && (!mzk || i.mzk_name === mzk)

type ListProps = { canManage: boolean; onPay: (i: ScheduleItem) => void }

// ---------------------------------------------------------------- Ожидаются

export function ExpectedList({ canManage, onPay }: ListProps) {
  const navigate = useNavigate()
  const today = localIso()
  const monthEnd = localIso(new Date(parseIso(today).getFullYear(), parseIso(today).getMonth() + 1, 0))
  const [q, setQ] = useState('')
  const [mzk, setMzk] = useState('')
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month' | 'later'>('all')
  const { data = [], isLoading, isError, error, refetch } = useQuery({ queryKey: financeKeys.expected(), queryFn: financeApi.expected })

  const inPeriod = (i: ScheduleItem, p: typeof period) =>
    p === 'all' || (p === 'today' && i.due_date === today) || (p === 'week' && i.due_date <= addDays(today, 6))
    || (p === 'month' && i.due_date <= monthEnd) || (p === 'later' && i.due_date > addDays(today, 6))
  const rows = data.filter((i) => matches(i, q, mzk) && inPeriod(i, period))
  const exportCsv = () => downloadCsv(`ожидаются-${today}.csv`, ['Ученик', 'МЗК', 'Платёж', 'Срок оплаты', 'Сумма'],
    rows.map((i) => [i.student_name, i.mzk_name, paymentTitle(i), date(i.due_date), money(i.left, i.currency)]))

  return (
    <>
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="m-5" />}
      <FinFilterBar summary={`${payments(rows.length)} · ${moneyTotals(rows)}`}>
        <SearchBox value={q} onChange={setQ} />
        <MzkSelect items={data} value={mzk} onChange={setMzk} />
        <FinSelect aria-label="Период" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="w-44">
          <option value="all">Весь период</option>
          <option value="today">Сегодня</option>
          <option value="week">Ближайшие 7 дней</option>
          <option value="month">До конца месяца</option>
          <option value="later">Позже 7 дней</option>
        </FinSelect>
        <ExportButton disabled={!rows.length} onClick={exportCsv} />
      </FinFilterBar>
      <FinTable minWidth={860}>
        <thead><tr><Th>Ученик</Th><Th>МЗК</Th><Th>За что</Th><Th>Срок оплаты</Th><Th right>Сумма</Th><Th right> </Th></tr></thead>
        <tbody>
          {isLoading && <EmptyRow colSpan={6}>Загрузка…</EmptyRow>}
          {!isLoading && rows.length === 0 && <EmptyRow colSpan={6}>Ожидаемых платежей нет</EmptyRow>}
          {rows.map((i) => (
            <tr key={i.id}>
              <Td><StudentCell name={i.student_name} onOpen={() => navigate(`/finance/contracts/${i.contract_id}`)} /></Td>
              <Td className="whitespace-nowrap">{i.mzk_name ?? '—'}</Td>
              <Td>{paymentTitle(i)}</Td>
              <Td className="whitespace-nowrap">
                {date(i.due_date)}
                {i.due_date === today && <span className="ml-2"><FinBadge tone="yellow">сегодня</FinBadge></span>}
              </Td>
              <Td right className="font-semibold">{money(i.left, i.currency)}</Td>
              <Td right>{canManage && <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>}</Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <TotalRow><Td colSpan={4}>Итого</Td><Td right>{moneyTotals(rows)}</Td><Td /></TotalRow>
          )}
        </tbody>
      </FinTable>
    </>
  )
}

// ---------------------------------------------------------------- Просрочено

const AGE = {
  all: { label: 'Любой срок', min: 0, max: Infinity },
  b30: { label: 'До 30 дней', min: 0, max: 30 },
  b60: { label: '31–60 дней', min: 31, max: 60 },
  b61: { label: 'Более 60 дней', min: 61, max: Infinity },
} as const

export function OverdueList({ canManage, onPay }: ListProps) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [mzk, setMzk] = useState('')
  const [age, setAge] = useState<keyof typeof AGE>('all')
  const { data = [], isLoading, isError, error, refetch } = useQuery({ queryKey: financeKeys.overdue(), queryFn: financeApi.overdue })
  const inAge = (i: ScheduleItem, a: keyof typeof AGE) => i.days_overdue >= AGE[a].min && i.days_overdue <= AGE[a].max
  const rows = data.filter((i) => matches(i, q, mzk) && inAge(i, age))
  const today = localIso()
  const exportCsv = () => downloadCsv(`просрочены-${today}.csv`, ['Ученик', 'МЗК', 'Платёж', 'Срок оплаты', 'Просрочка, дн.', 'Сумма', 'Напоминание'],
    rows.map((i) => [i.student_name, i.mzk_name, paymentTitle(i), date(i.due_date), i.days_overdue, money(i.left, i.currency), i.reminded_at ? dateTime(i.reminded_at) : '']))

  return (
    <>
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="m-5" />}
      <FinFilterBar summary={`${payments(rows.length)} · ${moneyTotals(rows)}`}>
        <SearchBox value={q} onChange={setQ} />
        <MzkSelect items={data} value={mzk} onChange={setMzk} />
        <FinSelect aria-label="Срок просрочки" value={age} onChange={(e) => setAge(e.target.value as keyof typeof AGE)} className="w-44">
          {(Object.keys(AGE) as (keyof typeof AGE)[]).map((a) => <option key={a} value={a}>{AGE[a].label}</option>)}
        </FinSelect>
        <ExportButton disabled={!rows.length} onClick={exportCsv} />
      </FinFilterBar>
      <FinTable minWidth={1040}>
        <thead><tr><Th>Ученик</Th><Th>МЗК</Th><Th>Платёж</Th><Th>Срок оплаты</Th><Th right>Просрочка</Th><Th right>Сумма</Th><Th>Напоминали МЗК</Th><Th right> </Th></tr></thead>
        <tbody>
          {isLoading && <EmptyRow colSpan={8}>Загрузка…</EmptyRow>}
          {!isLoading && rows.length === 0 && <EmptyRow colSpan={8}>Просроченных платежей нет</EmptyRow>}
          {rows.map((i) => (
            <tr key={i.id}>
              <Td><StudentCell name={i.student_name} onOpen={() => navigate(`/finance/contracts/${i.contract_id}`)} /></Td>
              <Td className="whitespace-nowrap">{i.mzk_name ?? '—'}</Td>
              <Td>{paymentTitle(i)}</Td>
              <Td className="whitespace-nowrap">{date(i.due_date)}</Td>
              <Td right><FinBadge tone="bad">{plural(i.days_overdue, ['день', 'дня', 'дней'])}</FinBadge></Td>
              <Td right className="font-semibold">{money(i.left, i.currency)}</Td>
              <Td className="whitespace-nowrap text-[13px] text-p-muted">{i.reminded_at ? dateTime(i.reminded_at) : 'Не отправлялось'}</Td>
              {/* «Напомнить МЗК» — в карточке договора: здесь одна кнопка на строку. */}
              <Td right>{canManage && <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>}</Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <TotalRow><Td colSpan={5}>Итого</Td><Td right>{moneyTotals(rows)}</Td><Td colSpan={2} /></TotalRow>
          )}
        </tbody>
      </FinTable>
    </>
  )
}

// ---------------------------------------------------------------- Поступили

type Period = 'month' | 'prev' | 'week' | 'custom'

function periodRange(p: Period, from: string, to: string): [string, string] {
  const today = localIso()
  const d = parseIso(today)
  if (p === 'week') return [addDays(today, -6), today]
  if (p === 'prev') return [localIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), localIso(new Date(d.getFullYear(), d.getMonth(), 0))]
  if (p === 'custom') return [from || today, to || today]
  return [localIso(new Date(d.getFullYear(), d.getMonth(), 1)), today]
}

export function ReceivedList({ canManage }: { canManage: boolean }) {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState(addDays(localIso(), -30))
  const [customTo, setCustomTo] = useState(localIso())
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [noReceipt, setNoReceipt] = useState(false)
  const [from, to] = periodRange(period, customFrom, customTo)
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.received(from, to),
    queryFn: () => financeApi.received(from, to),
  })
  const rows = data.filter((p) => (!method || p.method === method) && (!noReceipt || !p.has_receipt))
  const byMethod = (m: PaymentMethod) => rows.filter((p) => p.method === m)
  const exportCsv = () => downloadCsv(`поступили-${from}-${to}.csv`, ['Дата оплаты', 'Ученик', 'За что', 'Способ', 'Сумма', 'Чек', 'Отметил'],
    rows.map((p) => [date(p.paid_at), p.student_name, paymentTitle(p), p.method ? METHOD_LABELS[p.method] : '', money(p.amount, p.currency), p.has_receipt ? 'есть' : 'нет', p.recorded_by]))

  return (
    <>
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="m-5" />}
      <FinFilterBar summary={
        <span>
          {paidCount(rows.length)} · {moneyTotals(rows, 'amount')}
          <span className="ml-2 font-normal text-p-muted">
            {(['kaspi', 'bank', 'cash'] as PaymentMethod[]).filter((m) => byMethod(m).length).map((m) => `${METHOD_LABELS[m]} ${moneyTotals(byMethod(m), 'amount')}`).join(' · ')}
          </span>
        </span>
      }>
        <FinSelect aria-label="Период" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-44">
          <option value="month">Этот месяц</option>
          <option value="prev">Прошлый месяц</option>
          <option value="week">Последние 7 дней</option>
          <option value="custom">Свой период</option>
        </FinSelect>
        {period === 'custom' && (
          <>
            <FinInput type="date" aria-label="С" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
            <FinInput type="date" aria-label="По" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
          </>
        )}
        <FinSelect aria-label="Способ" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | '')} className="w-40">
          <option value="">Все способы</option>
          {(['kaspi', 'bank', 'cash'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
        </FinSelect>
        <label className="flex h-[38px] items-center gap-2 px-1 text-sm text-p-text">
          <input type="checkbox" checked={noReceipt} onChange={(e) => setNoReceipt(e.target.checked)} className="h-4 w-4 accent-black" />
          Только без чека
        </label>
        <ExportButton disabled={!rows.length} onClick={exportCsv} />
      </FinFilterBar>
      <FinTable minWidth={960}>
        <thead><tr><Th>Дата оплаты</Th><Th>Ученик</Th><Th>За что</Th><Th>Способ</Th><Th right>Сумма</Th><Th>Чек</Th><Th>Отметил</Th></tr></thead>
        <tbody>
          {isLoading && <EmptyRow colSpan={7}>Загрузка…</EmptyRow>}
          {!isLoading && rows.length === 0 && <EmptyRow colSpan={7}>За период оплат нет</EmptyRow>}
          {rows.map((p) => (
            <tr key={p.id}>
              <Td className="whitespace-nowrap">{date(p.paid_at)}</Td>
              <Td><StudentCell name={p.student_name} onOpen={() => navigate(`/finance/contracts/${p.contract_id}`)} /></Td>
              <Td>{paymentTitle(p)}</Td>
              <Td>{p.method ? METHOD_LABELS[p.method] : '—'}</Td>
              <Td right className="font-semibold">{money(p.amount, p.currency)}</Td>
              <Td>
                {p.has_receipt ? <FinBadge tone="ok">Есть</FinBadge> : (
                  <span className="inline-flex items-center gap-2">
                    <FinBadge tone="yellow">Нет чека</FinBadge>
                    {canManage && <AttachReceiptButton paymentId={p.id} />}
                  </span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-[13px] text-p-muted">{p.recorded_by ?? '—'}</Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <TotalRow><Td colSpan={4}>Итого</Td><Td right>{moneyTotals(rows, 'amount')}</Td><Td colSpan={2} /></TotalRow>
          )}
        </tbody>
      </FinTable>
    </>
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
      const d = at(i.due_date)
      d.items.push(i)
      if (i.state === 'overdue') d.late += num(i.left)
      else if (i.state !== 'paid') d.wait += num(i.left)
    })
    received.forEach((p) => { if (p.paid_at) { const d = at(p.paid_at); d.got += num(p.amount); d.payments.push(p) } })
    return map
  }, [items, received])

  const inMonth = (iso: string) => iso >= monthFrom && iso <= monthTo
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
