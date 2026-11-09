import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { financeApi, financeKeys, type ScheduleItem } from '@/api/finance'
import {
  EmptyRow, FinBadge, FinButton, FinCard, FinPageHeader, FinTable, StudentCell, Td, Th,
} from '@/components/finance/ui'
import { NotionScheduleNotice } from '@/components/finance/NotionScheduleNotice'
import { PayDialog } from '@/components/finance/dialogs'
import { ExpectedList, OverdueList, PaymentsCalendar, ReceivedList } from '@/components/finance/PaymentLists'
import { METHOD_LABELS, date, dateTime, money, moneyTotals, parseIso, paymentTitle, payments, plural } from '@/components/finance/format'

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
const MONTHS = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

/** Блоки, которые раскрываются в полный список. Открытые хранятся в адресе:
 * `/finance?open=overdue,received&view=calendar` — работают «Назад» и ссылки
 * со старой страницы «Платежи». */
export type TodaySection = 'overdue' | 'expected' | 'received'
const SECTIONS: TodaySection[] = ['overdue', 'expected', 'received']

function ToggleButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <FinButton size="sm" aria-expanded={open} onClick={onClick}>
      {open ? <>Свернуть<ChevronUp className="h-4 w-4" aria-hidden="true" /></> : <>{children}<ChevronDown className="h-4 w-4" aria-hidden="true" /></>}
    </FinButton>
  )
}

/**
 * «Сегодня» — единственный экран про платежи (страница «Платежи» убрана
 * 09.11.2026 как повтор): сверху то, что требует действия сегодня, ниже —
 * полные списки, раскрываются по кнопке.
 */
export function FinanceTodayPage() {
  const { can } = useAuth()
  const canManage = can('finance_desk', 'manage')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.today(),
    queryFn: financeApi.today,
    refetchInterval: 60_000,
  })

  const opened = new Set((params.get('open') ?? '').split(',').filter((s): s is TodaySection => SECTIONS.includes(s as TodaySection)))
  const calendar = params.get('view') === 'calendar'
  const update = (patch: { open?: Set<TodaySection>; calendar?: boolean }) => {
    const next = new URLSearchParams(params)
    const open = patch.open ?? opened
    if (open.size) next.set('open', SECTIONS.filter((s) => open.has(s)).join(','))
    else next.delete('open')
    if (patch.calendar ?? calendar) next.set('view', 'calendar')
    else next.delete('view')
    setParams(next, { replace: true })
  }
  const toggle = (s: TodaySection) => {
    const next = new Set(opened)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    update({ open: next })
  }

  // Пришли по ссылке на конкретный список (например, со старой «Платежи») —
  // прокрутить к нему один раз, когда страница загрузилась.
  const first = SECTIONS.find((s) => opened.has(s))
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (scrolled || !data || !first || first === 'overdue') return
    document.getElementById(`fin-${first}`)?.scrollIntoView({ block: 'start' })
    setScrolled(true)
  }, [data, first, scrolled])

  const open = (contractId: string) => navigate(`/finance/contracts/${contractId}`)
  const waiting = data?.due_today.filter((i) => i.state !== 'paid') ?? []
  const day = data ? parseIso(data.today) : null
  const monthLine = data?.month_totals?.map((t) => `${money(t.received, t.currency)}; план ${money(t.planned, t.currency)}`).join(' / ')
    || (data ? `${money(data.month_received)}; план ${money(data.month_planned)}` : '')
  const receivedLine = data?.month_totals?.map((t) => money(t.received, t.currency)).join(' / ') || (data ? money(data.month_received) : '')

  return (
    <div>
      <FinPageHeader
        title="Сегодня"
        description={day && data ? `${WEEKDAYS[day.getDay()]}, ${date(data.today)}. Поступило в ${MONTHS[day.getMonth()]}: ${monthLine}.` : undefined}
      />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {isLoading && <p className="text-p-muted">Загрузка…</p>}

      {data && <NotionScheduleNotice count={data.notion_import_count} canManage={canManage} />}

      {data && (
        <div className="grid gap-5">
          <FinCard title="Оплаты на сегодня" meta={waiting.length ? `ждём ${payments(waiting.length)} на ${moneyTotals(waiting)}` : undefined}>
            <FinTable minWidth={680}>
              <thead><tr><Th>Ученик</Th><Th>За что</Th><Th right>Сумма</Th><Th right> </Th></tr></thead>
              <tbody>
                {data.due_today.length === 0 && <EmptyRow colSpan={4}>На сегодня платежей по графику нет</EmptyRow>}
                {data.due_today.map((i) => (
                  <tr key={i.id}>
                    <Td><StudentCell name={i.student_name} sub={i.mzk_name ? `МЗК ${i.mzk_name}` : 'МЗК не указан'} onOpen={() => open(i.contract_id)} /></Td>
                    <Td>{paymentTitle(i)}</Td>
                    <Td right className="font-semibold">{money(i.state === 'paid' ? i.amount : i.left, i.currency)}</Td>
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

          <div id="fin-overdue">
            <FinCard
              title="Просрочено"
              meta={data.overdue_count ? `${payments(data.overdue_count)}${!opened.has('overdue') && data.overdue_count > data.overdue.length ? '; ниже самые ранние' : ''}` : undefined}
              actions={data.overdue_count > 0 && (
                <ToggleButton open={opened.has('overdue')} onClick={() => toggle('overdue')}>
                  {data.overdue_count > data.overdue.length ? `Показать все (${data.overdue_count})` : 'Фильтры и экспорт'}
                </ToggleButton>
              )}
            >
              {opened.has('overdue') ? <OverdueList canManage={canManage} onPay={setPaying} /> : (
                <FinTable minWidth={680}>
                  <thead><tr><Th>Ученик</Th><Th>Срок оплаты</Th><Th right>Просрочка</Th><Th right>Сумма</Th></tr></thead>
                  <tbody>
                    {data.overdue.length === 0 && <EmptyRow colSpan={4}>Просроченных платежей нет</EmptyRow>}
                    {data.overdue.map((i) => (
                      <tr key={i.id}>
                        <Td><StudentCell name={i.student_name} sub={i.mzk_name ? `МЗК ${i.mzk_name}` : 'МЗК не указан'} onOpen={() => open(i.contract_id)} /></Td>
                        <Td className="whitespace-nowrap">{date(i.due_date)}</Td>
                        <Td right><FinBadge tone="bad">{plural(i.days_overdue, ['день', 'дня', 'дней'])}</FinBadge></Td>
                        <Td right className="font-semibold">{money(i.left, i.currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </FinTable>
              )}
            </FinCard>
          </div>

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

          <div id="fin-expected">
            <FinCard
              title="Ожидаются"
              meta="будущие платежи по графику"
              actions={<>
                {opened.has('expected') && (
                  <div role="group" aria-label="Вид" className="inline-flex rounded-lg border border-p-line bg-white p-0.5">
                    {([[false, 'Списком'], [true, 'Календарём']] as const).map(([v, label]) => (
                      <button key={label} type="button" aria-pressed={calendar === v} onClick={() => update({ calendar: v })}
                        className={calendar === v ? 'h-7 rounded-md bg-black px-3 text-[13px] font-semibold text-white' : 'h-7 rounded-md px-3 text-[13px] font-semibold text-p-muted hover:text-p-text'}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <ToggleButton open={opened.has('expected')} onClick={() => toggle('expected')}>Показать</ToggleButton>
              </>}
            >
              {opened.has('expected') && (calendar
                ? <PaymentsCalendar canManage={canManage} onPay={setPaying} />
                : <ExpectedList canManage={canManage} onPay={setPaying} />)}
            </FinCard>
          </div>

          <div id="fin-received">
            <FinCard
              title="Поступили"
              meta={day ? `в ${MONTHS[day.getMonth()]}: ${receivedLine}` : undefined}
              actions={<ToggleButton open={opened.has('received')} onClick={() => toggle('received')}>Показать</ToggleButton>}
            >
              {opened.has('received') && <ReceivedList canManage={canManage} />}
            </FinCard>
          </div>
        </div>
      )}
      <PayDialog item={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
