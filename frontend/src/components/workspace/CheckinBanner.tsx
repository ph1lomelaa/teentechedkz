import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock } from 'lucide-react'
import { checkinsApi } from '@/api/checkins'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Ежедневная отметка «Я на месте». Показывается только тем, кому чекин
 * положен (менторы и МЗК в рабочий день) — признак приходит с бэкенда, чтобы
 * правило жило в одном месте, а не дублировалось здесь ролью.
 */
export const CheckinBanner: React.FC = () => {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['checkins', 'today'],
    queryFn: checkinsApi.today,
  })

  const mutation = useMutation({
    mutationFn: () => checkinsApi.checkIn(),
    onSuccess: (checkin) => {
      queryClient.invalidateQueries({ queryKey: ['checkins'] })
      toast({
        title: checkin.status === 'late' ? 'Отмечено с опозданием' : 'Отмечено вовремя',
      })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось отметиться'), variant: 'destructive' }),
  })

  if (isLoading || !data?.required) return null

  const { checkin, window: w } = data
  const opensAt = `${pad(w.hour)}:${pad(w.minute)}`

  if (checkin) {
    const done = checkin.status !== 'missed'
    return (
      <div
        className={cn(
          'mb-5 flex flex-wrap items-center gap-3 rounded-card border px-4 py-3',
          done ? 'border-w-good/40 bg-w-good/10' : 'border-w-danger/40 bg-w-danger/10'
        )}
      >
        <CheckCircle2 className={cn('h-5 w-5 shrink-0', done ? 'text-w-good' : 'text-w-danger')} />
        <div className="min-w-0 text-sm">
          <div className="font-bold text-w-ink">
            {checkin.status === 'on_time' && 'Вы отметились вовремя'}
            {checkin.status === 'late' && 'Вы отметились с опозданием'}
            {checkin.status === 'missed' && 'Отметка на сегодня пропущена'}
          </div>
          {checkin.checked_in_at && (
            <div className="text-xs text-w-muted">
              {new Date(checkin.checked_in_at).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-w-accentDim bg-w-accent/10 px-4 py-3">
      <Clock className="h-5 w-5 shrink-0 text-w-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-bold text-w-ink">Отметьтесь на сегодня</div>
        <div className="text-xs text-w-muted">
          Отметка в {opensAt} — вовремя, если успеть за {w.grace_minutes} минут.
        </div>
      </div>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="h-10 shrink-0 rounded-xl bg-w-accent px-4 text-xs font-black text-black transition hover:brightness-110 disabled:opacity-60"
      >
        {mutation.isPending ? 'Отмечаем…' : 'Я на месте'}
      </button>
    </div>
  )
}
