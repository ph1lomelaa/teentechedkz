import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { financeApi } from '@/api/finance'
import { FinButton, FinCard, FinField, FinInput, FinPageHeader, FinSelect } from '@/components/finance/ui'

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

  return (
    <div className="max-w-3xl">
      <FinPageHeader title="Настройки писем" description={data?.address ? `Письма приходят на ${data.address}` : undefined} />
      {isError && <QueryError colorPrefix="p" error={error} onRetry={refetch} className="mb-5" />}
      {isLoading && <p className="text-p-muted">Загрузка…</p>}
      {data && (
        <div className="grid gap-4">
          <FinCard title="Письмо сразу">
            <div className="grid gap-3 px-5 py-4 text-sm">
              <p className="text-p-muted">Об этих событиях письмо приходит сразу. Остальное — в утренней сводке и в колокольчике.</p>
              {(data.urgent_options ?? []).map((o) => (
                <label key={o.key} className="flex items-center gap-3">
                  <input type="checkbox" className="accent-black" checked={urgent.includes(o.key)}
                    onChange={(e) => setUrgent((u) => e.target.checked ? [...u, o.key] : u.filter((k) => k !== o.key))} />
                  {o.label}
                </label>
              ))}
            </div>
          </FinCard>
          <FinCard title="Утренняя сводка">
            <div className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
              <label className="flex items-center gap-3 sm:col-span-2">
                <input type="checkbox" className="accent-black" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
                {isAdmin ? 'Получать утреннюю сводку финансов' : 'Присылать утреннюю сводку'}
              </label>
              <FinField label="Время сводки (Алматы, рабочие дни)" htmlFor="fin-summary-hour">
                <FinSelect id="fin-summary-hour" value={hour} disabled={!summary} onChange={(e) => setHour(Number(e.target.value))}>
                  {[6, 7, 8, 9, 10, 11, 12].map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
                </FinSelect>
              </FinField>
            </div>
          </FinCard>
          {user?.role === 'finance_manager' && (
            <FinCard title="Нет на месте">
              <div className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
                <p className="text-p-muted sm:col-span-3">На время отпуска или больничного письма, сводку и колокольчик получает заместитель.</p>
                <FinField label="С" htmlFor="fin-away-from"><FinInput id="fin-away-from" type="date" value={awayFrom} onChange={(e) => setAwayFrom(e.target.value)} /></FinField>
                <FinField label="По" htmlFor="fin-away-to"><FinInput id="fin-away-to" type="date" min={awayFrom || undefined} value={awayTo} onChange={(e) => setAwayTo(e.target.value)} /></FinField>
                <FinField label="Заместитель" htmlFor="fin-deputy">
                  <FinSelect id="fin-deputy" value={deputy} onChange={(e) => setDeputy(e.target.value)}>
                    <option value="">Не выбран</option>
                    {(data.deputy_options ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role === 'admin' ? 'админ' : 'финансист'}</option>)}
                  </FinSelect>
                </FinField>
                {(awayFrom || awayTo) && <button type="button" className="text-left text-[13px] text-[#1D4ED8] underline sm:col-span-3" onClick={() => { setAwayFrom(''); setAwayTo(''); setDeputy('') }}>Я на месте — убрать даты</button>}
              </div>
            </FinCard>
          )}
          <div><FinButton variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохранение…' : 'Сохранить'}</FinButton></div>
        </div>
      )}
    </div>
  )
}
