import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useFinanceMode } from '@/components/finance/useFinanceMode'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi, financeKeys, type OfferDue, type ScheduleItem } from '@/api/finance'
import { EmptyRow, FinBadge, FinButton, FinCard, FinPageHeader, FinTable, StudentCell, Td, Th } from '@/components/finance/ui'
import { PayDialog } from '@/components/finance/dialogs'
import { ExpectedList, OffersList, OverdueList, PaymentsCalendar, ReceivedList } from '@/components/finance/PaymentLists'
import { date, money, moneyTotals, num, parseIso, paymentTitle, payments, plural } from '@/components/finance/format'

const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

/** Раскрываемые списки. Открытые хранятся в адресе: `/finance?open=overdue,received`
 * (ссылки из писем и со старых адресов продолжают работать). */
export type TodaySection = 'overdue' | 'offers' | 'expected' | 'received' | 'calendar'
const SECTIONS: TodaySection[] = ['overdue', 'offers', 'expected', 'received', 'calendar']

function ToggleButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <FinButton size="sm" aria-expanded={open} onClick={onClick}>
      {open ? <>Свернуть<ChevronUp className="h-4 w-4" aria-hidden="true" /></> : <>{children}<ChevronDown className="h-4 w-4" aria-hidden="true" /></>}
    </FinButton>
  )
}

/** Плитка с цифрой сверху «Платежей»: по нажатию раскрывает нужный список. */
function Metric({ label, value, hint, onClick, bar, bad }: { label: string; value: string; hint?: string; onClick?: () => void; bar?: number; bad?: boolean }) {
  const body = (
    <>
      <span className="block text-[13px] text-p-muted">{label}</span>
      <span className={`mt-1 block text-lg font-semibold ${bad ? 'text-[var(--fin-bad)]' : 'text-p-text'}`}>{value}</span>
      {bar !== undefined && (
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-[var(--fin-neutral-bg)]">
          <span className="block h-full bg-p-text" style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </span>
      )}
      {hint && <span className="mt-0.5 block text-xs text-p-muted">{hint}</span>}
      {onClick && <span className="mt-1 block text-xs text-p-muted underline underline-offset-2">Открыть список</span>}
    </>
  )
  const tile = 'rounded-xl border border-p-line bg-white px-4 py-3 text-left'
  return onClick
    ? <button type="button" onClick={onClick} className={`${tile} hover:border-p-muted`}>{body}</button>
    : <div className={tile}>{body}</div>
}

/** Заголовок раздела страницы: «Сегодня, 15.11.2026», «Все списки». */
function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="text-xs font-bold uppercase tracking-[.14em] text-p-muted">{children}</h2>
}

/**
 * «Платежи» (бывшее «Сегодня», решение 14.11.2026): отдельной страницы
 * «Платежи» нет — сверху дела на сегодня, ниже свёрнутые полные списки.
 * Адрес /finance прежний: на него ведут ссылки из писем.
 */
export function FinanceTodayPage() {
  const { canEdit: canManage, viewOnly, canMarkSeen } = useFinanceMode()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [paying, setPaying] = useState<ScheduleItem | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: financeKeys.today(),
    queryFn: financeApi.today,
    refetchInterval: 60_000,
  })
  const offers = useQuery({ queryKey: financeKeys.offersDue(), queryFn: financeApi.offersDue })

  const legacyCalendar = params.get('view') === 'calendar'
  const opened = new Set((params.get('open') ?? '').split(',').filter((s): s is TodaySection => SECTIONS.includes(s as TodaySection)))
  if (legacyCalendar && opened.has('expected')) { opened.delete('expected'); opened.add('calendar') }
  const setOpened = (open: Set<TodaySection>) => {
    const next = new URLSearchParams(params)
    next.delete('view')
    if (open.size) next.set('open', SECTIONS.filter((s) => open.has(s)).join(','))
    else next.delete('open')
    setParams(next, { replace: true })
  }
  const toggle = (s: TodaySection) => {
    const next = new Set(opened)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    setOpened(next)
  }
  const reveal = (s: TodaySection) => {
    if (!opened.has(s)) setOpened(new Set([...opened, s]))
    window.setTimeout(() => document.getElementById(`fin-${s}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)
  }

  // Пришли по ссылке на конкретный список — прокрутить к нему один раз.
  const first = SECTIONS.find((s) => opened.has(s))
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (scrolled || !data || !first || first === 'overdue') return
    document.getElementById(`fin-${first}`)?.scrollIntoView({ block: 'start' })
    setScrolled(true)
  }, [data, first, scrolled])

  const seen = useMutation({
    mutationFn: (o: OfferDue) => financeApi.offerSeen(o.contract_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: financeKeys.all }),
    onError: (err) => toast({ title: 'Не сохранено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const issue = useMutation({
    mutationFn: (o: OfferDue) => financeApi.issueOffer(o.contract_id),
    onSuccess: (res, o) => {
      queryClient.invalidateQueries({ queryKey: financeKeys.all })
      toast({ title: 'Остаток выставлен', description: `${o.student_name}: ${money(o.remaining, o.currency)}, срок ${date(res.due_date)}` })
    },
    onError: (err) => toast({ title: 'Не удалось выставить остаток', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const open = (contractId: string) => navigate(`/finance/contracts/${contractId}`)
  const waiting = data?.due_today.filter((i) => i.state !== 'paid') ?? []
  const toIssue = (offers.data?.items ?? []).filter((o) => !o.issued_at)
  const day = data ? parseIso(data.today) : null
  const month = day ? MONTHS[day.getMonth()] : ''
  const received = num(data?.month_received)
  const planned = num(data?.month_planned)
  const review = data?.review_count ?? data?.changes_count ?? 0
  const noTasks = !!data && waiting.length === 0 && data.overdue_count === 0 && toIssue.length === 0 && !(data.refunds_to_pay?.length) && !(data.promised_today?.length)

  return (
    <div>
      <FinPageHeader title="Платежи" />
      {data?.notion_synced_at && Date.now() - new Date(data.notion_synced_at).getTime() > 30 * 60 * 1000 && (
        <p role="status" className="mb-4 rounded-lg border border-p-line bg-white px-4 py-3 text-sm">
          Данные из Notion на {new Date(data.notion_synced_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: синхронизация не обновлялась больше 30 минут, суммы могут быть устаревшими.
        </p>
      )}
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {isLoading && <p className="text-p-muted">Загрузка…</p>}

      {data && (
        <div className="grid gap-8">
          {/* Четыре цифры — отдельными плитками, по нажатию ведут к списку. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {viewOnly
              ? <Metric label="Ждут оффера" hint="остаток оплатят после оффера"
                value={data.waiting_offer_count ? `${plural(data.waiting_offer_count, ['ученик', 'ученика', 'учеников'])} на ${money(data.waiting_offer_total ?? '0')}` : 'нет'}
                onClick={data.waiting_offer_count ? () => navigate('/finance/contracts?quick=waiting_offer') : undefined} />
              : <Metric label="Ждём сегодня" value={waiting.length ? `${payments(waiting.length)} на ${money(data.due_today_total ?? '0')}` : 'нет'} />}
            <Metric label={viewOnly ? 'Просрочено после оффера' : 'Просрочено'} bad={data.overdue_count > 0} value={data.overdue_count ? `${payments(data.overdue_count)} на ${money(data.overdue_total)}` : 'нет'}
              onClick={data.overdue_count ? () => reveal('overdue') : undefined} />
            <Metric label="Оффер получен" value={toIssue.length ? plural(toIssue.length, ['ученик', 'ученика', 'учеников']) : 'нет'}
              onClick={toIssue.length ? () => reveal('offers') : undefined} />
            {viewOnly
              ? <Metric label="Ждут просмотра" value={String(review)} onClick={() => navigate('/finance/review')} />
              : <Metric label={`Поступило в ${month}`} value={`${money(received)} из ${money(planned)}`}
                bar={planned > 0 ? (received / planned) * 100 : undefined} onClick={() => reveal('received')} />}
          </div>

          <section aria-labelledby="fin-h-day" className="grid gap-4">
            <SectionTitle id="fin-h-day">Сегодня, {date(data.today)}</SectionTitle>
            {noTasks && (
              <FinCard>
                <p className="px-5 py-6 text-sm text-p-muted">
                  На сегодня дел нет.{data.next_expected?.due_date && ` Ближайший платёж: ${data.next_expected.student_name}, ${money(data.next_expected.left, data.next_expected.currency)}, ${date(data.next_expected.due_date)}.`}
                </p>
              </FinCard>
            )}

            {toIssue.length > 0 && (
              <div id="fin-offers">
                <FinCard title={viewOnly ? 'Оффер получен' : 'Выставить остаток после оффера'}
                  meta={`${plural(toIssue.length, ['ученик', 'ученика', 'учеников'])} на ${moneyTotals(toIssue.map((o) => ({ amount: o.remaining, currency: o.currency })))}`}
                  actions={(offers.data?.total ?? 0) > 5 || opened.has('offers')
                    ? <ToggleButton open={opened.has('offers')} onClick={() => toggle('offers')}>Все офферы ({offers.data?.total ?? 0})</ToggleButton> : undefined}>
                  {opened.has('offers')
                    ? <div className="py-4"><OffersList rows={offers.data?.items} loading={offers.isPending} error={offers.error} onRetry={() => offers.refetch()} /></div>
                    : <FinTable minWidth={760}>
                      <thead><tr><Th>Ученик</Th><Th>Вуз</Th><Th>Оффер от</Th><Th right>Остаток</Th><Th right> </Th></tr></thead>
                      <tbody>
                        {toIssue.slice(0, 5).map((o) => (
                          <tr key={o.contract_id}>
                            <Td><StudentCell name={o.student_name} onOpen={() => open(o.contract_id)} />
                              {o.notion_url && <a href={o.notion_url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-p-muted underline underline-offset-2 hover:text-p-text">Notion ↗</a>}</Td>
                            <Td>{o.university}{o.enrolled && <span className="ml-2"><FinBadge tone="neutral">зачислен</FinBadge></span>}</Td>
                            <Td className="whitespace-nowrap">{o.offer_at ? date(o.offer_at.slice(0, 10)) : '—'}</Td>
                            <Td right>
                              <span className="font-semibold">{money(o.remaining, o.currency)}</span>
                              {o.by_payments != null && <div className="text-xs text-p-muted">В Notion {money(o.remaining, o.currency)}, по оплатам {money(o.by_payments, o.currency)}</div>}
                            </Td>
                            <Td right>{canManage
                              ? <FinButton size="sm" disabled={issue.isPending} onClick={() => issue.mutate(o)}>Выставить</FinButton>
                              : viewOnly && canMarkSeen && <FinButton size="sm" disabled={seen.isPending} onClick={() => seen.mutate(o)}>Просмотрено</FinButton>}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </FinTable>}
                </FinCard>
              </div>
            )}

            {waiting.length > 0 && (
              <FinCard title="Оплаты на сегодня" meta={`${payments(waiting.length)} на ${money(data.due_today_total ?? '0')}`}>
                <FinTable minWidth={760}>
                  <thead><tr><Th>Ученик</Th><Th>За что</Th><Th right>Сумма</Th><Th right> </Th></tr></thead>
                  <tbody>
                    {waiting.map((i) => (
                      <tr key={i.id}>
                        <Td><StudentCell name={i.student_name} onOpen={() => open(i.contract_id)} /></Td>
                        <Td>{paymentTitle(i)}</Td>
                        <Td right className="font-semibold">{money(i.left, i.currency)}</Td>
                        <Td right>{canManage && <FinButton size="sm" onClick={() => setPaying(i)}>Отметить оплату</FinButton>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </FinTable>
              </FinCard>
            )}

            {(data.refunds_to_pay?.length ?? 0) > 0 && (
              <FinCard title="Выплатить возврат" meta={String(data.refunds_to_pay!.length)}>
                <FinTable minWidth={760}>
                  <thead><tr><Th>Ученик</Th><Th>Решение</Th><Th right>Согласовано</Th><Th right> </Th></tr></thead>
                  <tbody>
                    {data.refunds_to_pay!.map((r) => (
                      <tr key={r.id}>
                        <Td><StudentCell name={r.student_name ?? '—'} onOpen={r.contract_id ? () => open(r.contract_id!) : undefined} /></Td>
                        <Td className="text-[13px]">{r.decision ?? '—'}</Td>
                        <Td right className="font-semibold">{money(r.approved ?? r.requested)}</Td>
                        <Td right><FinButton size="sm" onClick={() => navigate('/finance/refunds')}>Выплатить</FinButton></Td>
                      </tr>
                    ))}
                  </tbody>
                </FinTable>
              </FinCard>
            )}

            {(data.promised_today?.length ?? 0) > 0 && (
              <FinCard title="Обещали оплатить сегодня" meta={String(data.promised_today!.length)}>
                <FinTable minWidth={760}>
                  <thead><tr><Th>Ученик</Th><Th>Обещание</Th><Th right>Сумма</Th><Th right> </Th></tr></thead>
                  <tbody>
                    {data.promised_today!.map((i) => (
                      <tr key={i.id}>
                        <Td><StudentCell name={i.student_name} onOpen={() => open(i.contract_id)} /></Td>
                        <Td className="text-[13px]">{i.promise.text}</Td>
                        <Td right className="font-semibold">{money(i.promise.promise_amount ?? i.left, i.currency)}</Td>
                        <Td right>{canManage && <FinButton size="sm" onClick={() => setPaying(i)}>Отметить оплату</FinButton>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </FinTable>
              </FinCard>
            )}

            {data.overdue_count > 0 && (
              <FinCard title="Просрочено" meta={`${payments(data.overdue_count)} на ${money(data.overdue_total)}${data.overdue_count > data.overdue.length ? ` · показаны ${data.overdue.length} самых давних` : ''}`}
                actions={<FinButton size="sm" onClick={() => navigate('/finance/debts')}>Все долги</FinButton>}>
                <FinTable minWidth={760}>
                  <thead><tr><Th>Ученик</Th><Th>Срок оплаты</Th><Th right>Просрочка</Th><Th right>Сумма</Th><Th>Последнее действие</Th><Th right> </Th></tr></thead>
                  <tbody>
                    {data.overdue.length === 0 && <EmptyRow colSpan={6}>Просроченных платежей нет</EmptyRow>}
                    {data.overdue.map((i) => (
                      <tr key={i.id}>
                        <Td><StudentCell name={i.student_name} onOpen={() => open(i.contract_id)} /></Td>
                        <Td className="whitespace-nowrap">{date(i.due_date)}</Td>
                        <Td right><FinBadge tone="bad">{plural(i.days_overdue, ['день', 'дня', 'дней'])}</FinBadge></Td>
                        <Td right className="font-semibold">{money(i.left, i.currency)}</Td>
                        <Td className="text-[13px]">
                          {i.promise_broken && <span className="mr-2 text-[var(--fin-bad)]">обещание нарушено</span>}
                          {i.last_action ? <span className="text-p-muted">{i.last_action.label}, {date(i.last_action.at.slice(0, 10))}</span> : <span className="text-p-muted2">—</span>}
                        </Td>
                        <Td right>{canManage && <FinButton size="sm" onClick={() => setPaying(i)}>Отметить оплату</FinButton>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </FinTable>
              </FinCard>
            )}
          </section>

          <section aria-labelledby="fin-h-lists" className="grid gap-4">
            <SectionTitle id="fin-h-lists">Все списки</SectionTitle>
            <div id="fin-overdue">
              <FinCard title="Просроченные платежи" meta={data.overdue_count ? `${payments(data.overdue_count)} на ${money(data.overdue_total)}` : 'просрочек нет'}
                actions={data.overdue_count > 0 && <ToggleButton open={opened.has('overdue')} onClick={() => toggle('overdue')}>Показать</ToggleButton>}>
                {opened.has('overdue') && <div className="py-4"><OverdueList canManage={canManage} onPay={setPaying} /></div>}
              </FinCard>
            </div>

            <div id="fin-expected">
              <FinCard
                title="Ожидаются"
                meta={data.expected_count !== undefined ? (data.expected_count ? `${payments(data.expected_count)} на ${money(data.expected_total ?? '0')}` : 'платежей впереди нет') : 'будущие платежи по графику'}
                actions={<ToggleButton open={opened.has('expected')} onClick={() => toggle('expected')}>Показать</ToggleButton>}
              >
                {opened.has('expected') && <div className="py-4"><ExpectedList canManage={canManage} onPay={setPaying} /></div>}
              </FinCard>
            </div>

            {!viewOnly && <div id="fin-received">
              <FinCard
                title="Поступили"
                meta={`в ${month}: ${money(received)}`}
                actions={<ToggleButton open={opened.has('received')} onClick={() => toggle('received')}>Показать</ToggleButton>}
              >
                {opened.has('received') && <div className="py-4"><ReceivedList canManage={canManage} /></div>}
              </FinCard>
            </div>}

            <div id="fin-calendar">
              <FinCard
                title="Календарь"
                meta={`план на ${day ? MONTHS_NOM[day.getMonth()] : ''}: ${money(planned)}`}
                actions={<ToggleButton open={opened.has('calendar')} onClick={() => toggle('calendar')}>Показать</ToggleButton>}
              >
                {opened.has('calendar') && <PaymentsCalendar canManage={canManage} onPay={setPaying} />}
              </FinCard>
            </div>
          </section>
        </div>
      )}
      <PayDialog item={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
