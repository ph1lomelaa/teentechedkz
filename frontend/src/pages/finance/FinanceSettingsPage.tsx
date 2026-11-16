import { useEffect, useState } from 'react'
import { Bell, Mail, Sunrise } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi } from '@/api/finance'
import { FinButton, FinCard, FinField, FinInput, FinPageHeader, FinSelect } from '@/components/finance/ui'
import { cn } from '@/lib/utils'

// Короткое имя и пояснение к каждому событию; если сервер пришлёт новый ключ — покажем его подпись как есть.
const EVENT_TEXT: Record<string, { title: string; hint: string }> = {
  offer: { title: 'Оффер получен', hint: 'Ментор отметил оффер — пора ждать оплату остатка.' },
  offer_cancelled: { title: 'Оффер отменён', hint: 'Отметку оффера сняли — срок оплаты остатка отменяется.' },
  client_fee: { title: 'Изменилась сумма договора', hint: 'В Notion поменяли общую сумму договора.' },
  status: { title: 'Статус договора', hint: 'Договор ушёл в возврат, на паузу или расторгнут.' },
  remaining: { title: 'Другие правки денег в Notion', hint: 'Остаток, дата оплаты, оплаты английского и UP.' },
  refund: { title: 'Возврат', hint: 'Запрос на возврат и решение по нему.' },
}
const HOURS = [6, 7, 8, 9, 10, 11, 12]

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-p-line')}>
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-p-text">{title}</p>
        {hint && <p className="mt-0.5 text-[13px] text-p-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** «Настройки писем» (задание 7): какие события приходят письмом сразу,
 * во сколько утренняя сводка, получать ли её (админ подписывается сам). */
export function FinanceSettingsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['finance', 'prefs'], queryFn: financeApi.prefs })
  const [urgent, setUrgent] = useState<string[]>([])
  const [hour, setHour] = useState(9)
  const [summary, setSummary] = useState(true)
  const [awayFrom, setAwayFrom] = useState('')
  const [awayTo, setAwayTo] = useState('')
  const [deputy, setDeputy] = useState('')
  useEffect(() => {
    if (!data) return
    setUrgent(data.urgent)
    setHour(data.summary_hour)
    setSummary(data.summary)
    setAwayFrom(data.away_from ?? '')
    setAwayTo(data.away_to ?? '')
    setDeputy(data.deputy_id ?? '')
  }, [data])
  const save = useMutation({
    mutationFn: () => financeApi.savePrefs({ urgent, summary_hour: hour, summary,
      away_from: awayFrom || null, away_to: awayTo || null, deputy_id: awayFrom ? deputy || null : null }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['finance', 'prefs'] }); toast({ title: 'Настройки писем сохранены' }) },
    onError: (err) => toast({ title: 'Не сохранено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const isAdmin = user?.role === 'admin'
  const dirty = !!data && (
    [...urgent].sort().join() !== [...data.urgent].sort().join() || hour !== data.summary_hour || summary !== data.summary
    || awayFrom !== (data.away_from ?? '') || awayTo !== (data.away_to ?? '') || deputy !== (data.deputy_id ?? ''))
  const options = data?.urgent_options ?? []

  return (
    <div className="pb-24">
      <FinPageHeader title="Настройки писем" description="Что приходит письмом сразу, а что — утренней сводкой и в колокольчике." />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {isLoading && <p className="text-p-muted">Загрузка…</p>}
      {data && (
        <div className="grid gap-4">
          <div className="flex items-center gap-4 rounded-xl border border-p-line bg-white px-5 py-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand text-black"><Mail className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <p className="text-[13px] text-p-muted">Письма приходят на</p>
              <p className="truncate text-base font-semibold text-p-text">{data.address || 'адрес не указан'}</p>
            </div>
          </div>

          {/* На широком экране — две колонки на всю ширину: слева события, справа сводка и замена. */}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
          <FinCard title="Письмо сразу" meta={`включено ${urgent.filter((k) => options.some((o) => o.key === k)).length} из ${options.length}`}
            actions={<span className="inline-flex items-center gap-1.5 text-[13px] text-p-muted"><Bell className="h-3.5 w-3.5" aria-hidden="true" />остальное — в сводке и колокольчике</span>}>
            <div className="divide-y divide-p-line">
              {options.map((o) => {
                const t = EVENT_TEXT[o.key] ?? { title: o.label, hint: undefined }
                return (
                  <Row key={o.key} title={t.title} hint={t.hint}>
                    <Toggle label={t.title} checked={urgent.includes(o.key)}
                      onChange={(on) => setUrgent((u) => on ? [...u, o.key] : u.filter((k) => k !== o.key))} />
                  </Row>
                )
              })}
            </div>
          </FinCard>

          <div className="grid gap-4">
          <FinCard title="Утренняя сводка">
            <div className="divide-y divide-p-line">
              <Row title={isAdmin ? 'Получать утреннюю сводку финансов' : 'Присылать утреннюю сводку'} hint="Одно письмо в рабочие дни: что ждём сегодня, просрочки, новые правки.">
                <Toggle label="Утренняя сводка" checked={summary} onChange={setSummary} />
              </Row>
              <div className={cn('px-5 py-4', !summary && 'opacity-50')}>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-p-text"><Sunrise className="h-4 w-4" aria-hidden="true" />Время (Алматы)</p>
                <div role="radiogroup" aria-label="Время сводки" className="mt-3 flex flex-wrap gap-2">
                  {HOURS.map((h) => (
                    <button key={h} type="button" role="radio" aria-checked={hour === h} disabled={!summary} onClick={() => setHour(h)}
                      className={cn('h-9 rounded-lg border px-3.5 text-sm font-semibold tabular-nums transition-colors disabled:cursor-not-allowed',
                        hour === h ? 'border-p-text bg-p-text text-p-bg' : 'border-p-line text-p-text hover:border-p-text')}>
                      {`${String(h).padStart(2, '0')}:00`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </FinCard>
          {user?.role === 'finance_manager' && (
            <FinCard title="Нет на месте">
              <div className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
                <p className="text-p-muted sm:col-span-2">На время отпуска или больничного письма, сводку и колокольчик получает заместитель.</p>
                <FinField label="С" htmlFor="fin-away-from"><FinInput id="fin-away-from" type="date" value={awayFrom} onChange={(e) => setAwayFrom(e.target.value)} /></FinField>
                <FinField label="По" htmlFor="fin-away-to"><FinInput id="fin-away-to" type="date" min={awayFrom || undefined} value={awayTo} onChange={(e) => setAwayTo(e.target.value)} /></FinField>
                <div className="sm:col-span-2"><FinField label="Заместитель" htmlFor="fin-deputy">
                  <FinSelect id="fin-deputy" value={deputy} onChange={(e) => setDeputy(e.target.value)}>
                    <option value="">Не выбран</option>
                    {(data.deputy_options ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role === 'admin' ? 'админ' : 'финансист'}</option>)}
                  </FinSelect>
                </FinField></div>
                {(awayFrom || awayTo) && <button type="button" className="text-left text-[13px] text-[#1D4ED8] underline sm:col-span-2" onClick={() => { setAwayFrom(''); setAwayTo(''); setDeputy('') }}>Я на месте — убрать даты</button>}
              </div>
            </FinCard>
          )}
          </div>
          </div>
          <div className={cn('flex items-center justify-between gap-4 rounded-xl border border-p-line bg-white px-5 py-3', dirty && 'sticky bottom-4 z-10 shadow-lg')}>
            <span className="text-sm text-p-muted">{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span>
            <FinButton variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохранение…' : 'Сохранить'}</FinButton>
          </div>
        </div>
      )}
    </div>
  )
}
