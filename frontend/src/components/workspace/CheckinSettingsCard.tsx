import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Clock } from 'lucide-react'
import { checkinsApi } from '@/api/checkins'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { timeIn } from '@/lib/checkinTimezone'

const pad = (n: number) => String(n).padStart(2, '0')

type PermissionState = NotificationPermission | 'unsupported'

function currentPermission(): PermissionState {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

/** Пояс отметки «Я на месте» и уведомления браузера.
 *
 * Регламент п.2.1: ментор отмечается в 10:00 по Алматы, а находящийся в
 * Европе — в 10:00 по своему времени. Пояс выбирает сам сотрудник; время
 * отметки не меняется, чтобы регламент нельзя было обойти.
 */
export const CheckinSettingsCard: React.FC = () => {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['checkins', 'today'], queryFn: checkinsApi.today })
  const [permission, setPermission] = useState<PermissionState>(currentPermission)

  const mutation = useMutation({
    mutationFn: (timezone: string) => checkinsApi.updateSettings({ timezone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkins'] })
      toast({ title: 'Пояс отметки сохранён' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось сохранить пояс'), variant: 'destructive' }),
  })

  if (!data) return null

  const { window: w, timezones } = data
  const opensAt = `${pad(w.hour)}:${pad(w.minute)}`
  const now = timeIn(w.timezone)

  const askPermission = async () => {
    try {
      setPermission(await Notification.requestPermission())
    } catch {
      setPermission(currentPermission())
    }
  }

  return (
    <section className="rounded-panel border border-w-line bg-w-panel p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-w-ink">
        <Clock className="h-4 w-4" />
        Отметка «Я на месте»
      </h2>
      <p className="mt-1 text-sm text-w-muted">
        Отмечаться нужно в {opensAt} по выбранному времени. Если вы в Европе — выберите свой город.
        За 10 минут до отметки придёт напоминание.
      </p>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-semibold text-w-muted">Часовой пояс</span>
        <select
          value={w.timezone}
          disabled={mutation.isPending}
          onChange={(e) => mutation.mutate(e.target.value)}
          className="h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none focus:border-w-accentDim disabled:opacity-60"
        >
          {timezones.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </label>
      {now && <p className="mt-2 text-xs text-w-muted">Сейчас по этому времени {now}.</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-w-line bg-w-panel2 px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-w-ink">
          <Bell className="h-4 w-4" />
          {permission === 'granted' && 'Уведомления браузера включены'}
          {permission === 'denied' && 'Уведомления браузера запрещены в настройках сайта'}
          {permission === 'default' && 'Уведомления браузера выключены'}
          {permission === 'unsupported' && 'Браузер не поддерживает уведомления'}
        </span>
        {permission === 'default' && (
          <button
            type="button"
            onClick={askPermission}
            className="rounded-ctl border border-w-line px-3 py-1.5 text-xs font-semibold text-w-ink transition hover:border-w-accentDim"
          >
            Включить
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-w-muted">
        Системное уведомление приходит, пока вкладка с сайтом открыта. В колокольчике оно будет в любом случае.
      </p>
    </section>
  )
}
