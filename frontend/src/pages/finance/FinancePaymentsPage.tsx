import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { cn } from '@/lib/utils'
import { financeApi, financeKeys, type PaymentMethod, type ReceivedPayment, type ScheduleItem } from '@/api/finance'
import {
  EmptyRow, FinBadge, FinButton, FinCard, FinFilterBar, FinInput, FinPageHeader, FinSelect, FinTable, FinTabs,
  ItemStatus, StudentCell, Td, Th, TotalRow,
} from '@/components/finance/ui'
import { AttachReceiptButton, PayDialog } from '@/components/finance/dialogs'
import {
  METHOD_LABELS, addDays, date, dateTime, downloadCsv, localIso, money, num, parseIso, paymentTitle, payments, plural,
} from '@/components/finance/format'

const paidCount = (n: number) => plural(n, ['оплата', 'оплаты', 'оплат'])

type Tab = 'expected' | 'overdue' | 'received' | 'calendar'
const TABS: Tab[] = ['expected', 'overdue', 'received', 'calendar']

const sum = (rows: { left?: string; amount: string }[], key: 'left' | 'amount' = 'left') =>
  rows.reduce((s, r) => s + num(key === 'left' ? r.left : r.amount), 0)

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

const matches = (i: { student_name: string; mzk_name?: string | null }, q: string, mzk: string) =>
  (!q || i.student_name.toLowerCase().includes(q.toLowerCase())) && (!mzk || i.mzk_name === mzk)

export function FinancePaymentsPage() {
  const [params, setParams] = useSearchParams()
  const raw = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'expected') as Tab
  // Календарь — не отдельная вкладка, а вид «Ожидаются»: те же платежи на сетке месяца.
  const tab = raw === 'calendar' ? 'expected' : raw
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })
  const { can } = useAuth()
  const canManage = can('finance_desk', 'manage')
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const { data: counters } = useQuery({ queryKey: financeKeys.counters(), queryFn: financeApi.counters })
  const [exporter, setExporter] = useState<(() => void) | null>(null)

  return (
    <div>
      <FinPageHeader
        title="Платежи"
        description="Ожидаемые, просроченные и поступившие оплаты клиентов по графику договоров."
        actions={<FinButton onClick={() => exporter?.()} disabled={!exporter || raw === 'calendar'}>Экспорт</FinButton>}
      />
      <FinTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'expected', label: 'Ожидаются' },
          { value: 'overdue', label: 'Просрочены', count: counters?.overdue },
          { value: 'received', label: 'Поступили' },
        ]}
      />
      {tab === 'expected' && (
        <>
          <div role="group" aria-label="Вид" className="mb-4 inline-flex rounded-lg border border-p-line bg-white p-1">
            {([['expected', 'Списком'], ['calendar', 'Календарём']] as const).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={raw === v} onClick={() => setTab(v)}
                className={raw === v ? 'h-9 rounded-md bg-black px-4 text-sm font-semibold text-white' : 'h-9 rounded-md px-4 text-sm font-semibold text-p-muted hover:text-p-text'}>
                {label}
              </button>
            ))}
          </div>
          {raw === 'calendar'
            ? <CalendarTab canManage={canManage} onPay={setPaying} />
            : <ExpectedTab canManage={canManage} onPay={setPaying} setExporter={setExporter} />}
        </>
      )}
      {tab === 'overdue' && <OverdueTab canManage={canManage} onPay={setPaying} setExporter={setExporter} />}
      {tab === 'received' && <ReceivedTab canManage={canManage} setExporter={setExporter} />}
      <PayDialog item={paying} onClose={() => setPaying(null)} />
    </div>
  )
}

type Exporter = (fn: (() => void) | null) => void

// ---------------------------------------------------------------- Ожидаются

function ExpectedTab({ canManage, onPay, setExporter }: { canManage: boolean; onPay: (i: ScheduleItem) => void; setExporter: Exporter }) {
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
  const exportFn = () => downloadCsv(`ожидаются-${today}.csv`, ['Ученик', 'МЗК', 'Платёж', 'Срок оплаты', 'Сумма'],
    rows.map((i) => [i.student_name, i.mzk_name, paymentTitle(i), date(i.due_date), money(i.left)]))
  useExporter(setExporter, exportFn)

  return (
    <>
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      <FinCard>
        <FinFilterBar summary={`${payments(rows.length)} · ${money(sum(rows))}`}>
          <SearchBox value={q} onChange={setQ} />
          <MzkSelect items={data} value={mzk} onChange={setMzk} />
          <FinSelect aria-label="Период" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="w-44">
            <option value="all">Весь период</option>
            <option value="today">Сегодня</option>
            <option value="week">Ближайшие 7 дней</option>
            <option value="month">До конца месяца</option>
            <option value="later">Позже 7 дней</option>
          </FinSelect>
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
                <Td right className="font-semibold">{money(i.left)}</Td>
                <Td right>{canManage && <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>}</Td>
              </tr>
            ))}
            {rows.length > 0 && (
              <TotalRow><Td colSpan={4}>Итого</Td><Td right>{money(sum(rows))}</Td><Td /></TotalRow>
            )}
          </tbody>
        </FinTable>
      </FinCard>
    </>
  )
}

// ---------------------------------------------------------------- Просрочены

const AGE = {
  all: { label: 'Любой срок', min: 0, max: Infinity },
  b30: { label: 'До 30 дней', min: 0, max: 30 },
  b60: { label: '31–60 дней', min: 31, max: 60 },
  b61: { label: 'Более 60 дней', min: 61, max: Infinity },
} as const

function OverdueTab({ canManage, onPay, setExporter }: { canManage: boolean; onPay: (i: ScheduleItem) => void; setExporter: Exporter }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [mzk, setMzk] = useState('')
  const [age, setAge] = useState<keyof typeof AGE>('all')
  const { data = [], isLoading, isError, error, refetch } = useQuery({ queryKey: financeKeys.overdue(), queryFn: financeApi.overdue })
  const inAge = (i: ScheduleItem, a: keyof typeof AGE) => i.days_overdue >= AGE[a].min && i.days_overdue <= AGE[a].max
  const rows = data.filter((i) => matches(i, q, mzk) && inAge(i, age))
  const today = localIso()
  useExporter(setExporter, () => downloadCsv(`просрочены-${today}.csv`, ['Ученик', 'МЗК', 'Платёж', 'Срок оплаты', 'Просрочка, дн.', 'Сумма', 'Напоминание'],
    rows.map((i) => [i.student_name, i.mzk_name, paymentTitle(i), date(i.due_date), i.days_overdue, money(i.left), i.reminded_at ? dateTime(i.reminded_at) : ''])))

  return (
    <>
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      <FinCard>
        <FinFilterBar summary={`${payments(rows.length)} · ${money(sum(rows))}`}>
          <SearchBox value={q} onChange={setQ} />
          <MzkSelect items={data} value={mzk} onChange={setMzk} />
          <FinSelect aria-label="Срок просрочки" value={age} onChange={(e) => setAge(e.target.value as keyof typeof AGE)} className="w-44">
            {(Object.keys(AGE) as (keyof typeof AGE)[]).map((a) => <option key={a} value={a}>{AGE[a].label}</option>)}
          </FinSelect>
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
                <Td right><FinBadge tone="bad">{i.days_overdue} дн.</FinBadge></Td>
                <Td right className="font-semibold">{money(i.left)}</Td>
                <Td className="whitespace-nowrap text-[13px] text-p-muted">{i.reminded_at ? dateTime(i.reminded_at) : 'Не отправлялось'}</Td>
                {/* «Напомнить МЗК» — в карточке договора: здесь одна кнопка на строку. */}
                <Td right>{canManage && <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>}</Td>
              </tr>
            ))}
            {rows.length > 0 && (
              <TotalRow><Td colSpan={5}>Итого</Td><Td right>{money(sum(rows))}</Td><Td colSpan={2} /></TotalRow>
            )}
          </tbody>
        </FinTable>
      </FinCard>
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

function ReceivedTab({ canManage, setExporter }: { canManage: boolean; setExporter: Exporter }) {
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
  const total = (list: ReceivedPayment[]) => list.reduce((s, p) => s + num(p.amount), 0)
  const byMethod = (m: PaymentMethod) => rows.filter((p) => p.method === m)
  useExporter(setExporter, () => downloadCsv(`поступили-${from}-${to}.csv`, ['Дата оплаты', 'Ученик', 'За что', 'Способ', 'Сумма', 'Чек', 'Отметил'],
    rows.map((p) => [date(p.paid_at), p.student_name, paymentTitle(p), p.method ? METHOD_LABELS[p.method] : '', money(p.amount), p.has_receipt ? 'есть' : 'нет', p.recorded_by])))

  return (
    <>
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      <FinCard>
        <FinFilterBar summary={
          <span>
            {paidCount(rows.length)} · {money(total(rows))}
            <span className="ml-2 font-normal text-p-muted">
              {(['kaspi', 'bank', 'cash'] as PaymentMethod[]).filter((m) => byMethod(m).length).map((m) => `${METHOD_LABELS[m]} ${money(total(byMethod(m)))}`).join(' · ')}
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
              <TotalRow><Td colSpan={4}>Итого</Td><Td right>{money(total(rows))}</Td><Td colSpan={2} /></TotalRow>
            )}
          </tbody>
        </FinTable>
      </FinCard>
    </>
  )
}

// ---------------------------------------------------------------- Календарь

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function CalendarTab({ canManage, onPay }: { canManage: boolean; onPay: (i: ScheduleItem) => void }) {
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
  const plan = items.filter((i) => inMonth(i.due_date)).reduce((s, i) => s + num(i.amount), 0)
  const got = received.filter((p) => p.paid_at && inMonth(p.paid_at)).reduce((s, p) => s + num(p.amount), 0)
  const wait = items.filter((i) => inMonth(i.due_date) && i.state !== 'paid').reduce((s, i) => s + num(i.left), 0)
  const day = byDay.get(picked)
  const shift = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
    setPicked(localIso(d) <= today && today <= localIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) ? today : localIso(d))
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <FinCard
        title={first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()).replace(' г.', '')}
        actions={
          <>
            <FinButton size="sm" aria-label="Предыдущий месяц" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></FinButton>
            <FinButton size="sm" aria-label="Следующий месяц" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></FinButton>
          </>
        }
      >
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
                  aria-label={`${date(iso)}: поступило ${money(v?.got ?? 0)}, ожидается ${money(v?.wait ?? 0)}, просрочено ${money(v?.late ?? 0)}`}
                  className={cn(
                    'flex min-h-[88px] flex-col gap-0.5 border-b border-r border-[var(--fin-line-soft)] px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--fin-head)]',
                    i % 7 >= 5 && 'bg-[#FBFAF7]',
                    outside && 'text-[var(--fin-text-3)] opacity-60',
                    picked === iso && 'outline outline-2 -outline-offset-2 outline-black',
                  )}
                >
                  <span className={cn('mb-1 grid h-6 w-6 place-items-center rounded-full text-[13px] font-semibold', iso === today && 'bg-brand text-black')}>{d.getDate()}</span>
                  {!!v?.got && <span className="truncate font-semibold text-[var(--fin-ok)]">+{money(v.got)}</span>}
                  {!!v?.wait && <span className="truncate font-semibold text-p-text">{money(v.wait)}</span>}
                  {!!v?.late && <span className="truncate font-semibold text-[var(--fin-bad)]">{money(v.late)}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-p-line text-sm">
          {[['План', money(plan), ''], ['Поступило', money(got), 'text-[var(--fin-ok)]'], ['Ожидается', money(wait), '']].map(([l, v, c]) => (
            <div key={l} className="border-r border-p-line px-5 py-3 last:border-r-0">
              <div className="text-[13px] text-p-muted">{l}</div>
              <div className={cn('font-bold', c)}>{v}</div>
            </div>
          ))}
        </div>
      </FinCard>

      <FinCard title={date(picked)} meta={day ? payments(day.items.length) : undefined}>
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
                  <span className="font-semibold">{money(i.state === 'paid' ? i.amount : i.left)}</span>
                  {canManage && i.state !== 'paid' && <FinButton size="sm" onClick={() => onPay(i)}>Отметить оплату</FinButton>}
                </div>
              </li>
            ))}
            {day.payments.filter((p) => !day.items.some((i) => i.id === p.schedule_item_id)).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <StudentCell name={p.student_name} sub={`Поступило · ${paymentTitle(p)}`} />
                <span className="font-semibold text-[var(--fin-ok)]">+{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </FinCard>
    </div>
  )
}

/** Кнопка «Экспорт» в шапке выгружает то, что видно во вкладке. */
function useExporter(setExporter: Exporter, fn: () => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    setExporter(() => () => ref.current())
    return () => setExporter(null)
  }, [setExporter])
}
