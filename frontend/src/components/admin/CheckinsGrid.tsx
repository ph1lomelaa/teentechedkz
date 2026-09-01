import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import { checkinsApi, type CheckinStatus } from '@/api/checkins'
import { EmptyState, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'
import { QueryState } from '@/components/shared/QueryState'

const DAY_OPTIONS = [7, 14, 30] as const

const STATUS_MARK: Record<CheckinStatus, { mark: string; label: string }> = {
  on_time: { mark: '✓', label: 'вовремя' },
  late: { mark: '!', label: 'опоздание' },
  missed: { mark: '×', label: 'пропуск' },
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

interface Props {
  colorPrefix?: AdminColorPrefix
}

/**
 * Сводка ежедневных отметок «я на месте» по менторам и МЗК.
 * Матрица сотрудник × день: так видно закономерности (кто регулярно
 * опаздывает), а не только отдельные факты.
 */
export const CheckinsGrid: React.FC<Props> = ({ colorPrefix = 'w' }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [days, setDays] = useState<number>(14)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkins', 'list', days],
    queryFn: () => checkinsApi.list({ days }),
  })
  const { data: summary } = useQuery({
    queryKey: ['checkins', 'summary', days],
    queryFn: () => checkinsApi.summary(days),
  })

  const { dates, byUser } = useMemo(() => {
    const items = data?.items ?? []
    const dateSet = new Set<string>()
    const map = new Map<string, Map<string, CheckinStatus>>()
    for (const c of items) {
      dateSet.add(c.checkin_date)
      if (!map.has(c.user_id)) map.set(c.user_id, new Map())
      map.get(c.user_id)!.set(c.checkin_date, c.status)
    }
    return { dates: [...dateSet].sort().reverse(), byUser: map }
  }, [data])

  const staff = data?.staff ?? []
  const summaryByUser = useMemo(
    () => new Map((summary?.items ?? []).map((r) => [r.user_id, r])),
    [summary],
  )

  const statusCell: Record<CheckinStatus, string> = {
    on_time: cn(t.good, 'bg-current/15'),
    late: cn(t.accentText, 'bg-current/15'),
    missed: cn(t.danger, t.dangerSoftBg),
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          colorPrefix={colorPrefix}
          eyebrow="Контроль"
          title="Чекины"
          description="Ежедневная отметка «я на месте» по менторам и МЗК."
        />
        <div className="flex gap-2">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'h-9 rounded-ctl border px-3 text-xs font-bold transition',
                days === d
                  ? cn('border-current bg-current/10', t.accentText)
                  : cn(t.borderLine, t.muted, 'hover:opacity-80'),
              )}
            >
              {d} дней
            </button>
          ))}
        </div>
      </div>

      <QueryState
        isLoading={isLoading}
        colorPrefix={colorPrefix}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={staff.length === 0}
        empty={(
          <EmptyState colorPrefix={colorPrefix} icon={<CalendarCheck className="h-5 w-5" />} title="Нет сотрудников с чекином" />
        )}
      >
        <div className={cn('overflow-x-auto rounded-card border', t.borderLine)}>
          <table className="w-full text-sm">
            <thead>
              <tr className={cn('border-b text-left text-2xs uppercase tracking-wide', t.borderLine, t.muted)}>
                <th className={cn('sticky left-0 px-3 py-2', t.panel)}>Сотрудник</th>
                <th className="px-3 py-2">Вовремя</th>
                <th className="px-3 py-2">Опоздания</th>
                <th className="px-3 py-2">Пропуски</th>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-bold">{shortDate(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => {
                const row = byUser.get(u.user_id)
                const s = summaryByUser.get(u.user_id)
                return (
                  <tr key={u.user_id} className={cn('border-b last:border-0', t.borderLine)}>
                    <td className={cn('sticky left-0 px-3 py-2 font-medium', t.panel, t.ink)}>
                      {u.user_name}
                      <div className={cn('text-2xs', t.muted2)}>{u.user_role}</div>
                    </td>
                    <td className={cn('px-3 py-2', t.good)}>{s?.on_time ?? 0}</td>
                    <td className={cn('px-3 py-2', t.accentText)}>{s?.late ?? 0}</td>
                    <td className={cn('px-3 py-2', t.danger)}>{s?.missed ?? 0}</td>
                    {dates.map((d) => {
                      const st = row?.get(d)
                      return (
                        <td key={d} className="px-2 py-2 text-center">
                          {st ? (
                            <span
                              className={cn(
                                'inline-block h-5 w-5 rounded text-[10px] font-black leading-5',
                                statusCell[st],
                              )}
                              title={STATUS_MARK[st].label}
                            >
                              {STATUS_MARK[st].mark}
                            </span>
                          ) : (
                            <span className={t.muted2}>·</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  )
}
