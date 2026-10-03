import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/hooks/use-toast'
import { useWsEvent } from '@/lib/ws'

const CHECKIN_KINDS = new Set(['checkin_soon', 'checkin_due'])

/** Напоминание об отметке «Я на месте» системным уведомлением браузера.
 *
 * Бэкенд (services/checkin_notifier.py) шлёт его за 10 минут до 10:00 в поясе
 * сотрудника и в 10:00. Колокольчик получает его всегда; системное окно
 * видно, даже когда человек в другой программе, — если вкладка открыта и
 * уведомления разрешены (включаются в профиле).
 */
export function useCheckinSystemNotifications(): void {
  const queryClient = useQueryClient()

  useWsEvent('notification.new', (data) => {
    const note = data as { kind?: string; title?: string; body?: string } | undefined
    if (!note?.kind || !CHECKIN_KINDS.has(note.kind)) return
    queryClient.invalidateQueries({ queryKey: ['checkins'] })

    // Служебную метку [checkin:…] человеку не показываем.
    const body = (note.body ?? '').replace(/\s*\[[a-z]+:[^\]]+\]\s*/g, ' ').trim()
    const title = note.title ?? 'Отметка «Я на месте»'
    if (document.visibilityState === 'visible') toast({ title, description: body })
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        // tag склеивает повтор, если вкладок с сайтом открыто несколько.
        new Notification(title, { body, tag: `checkin-${note.kind}` })
      }
    } catch {
      // системные уведомления — дополнительный канал, колокольчик работает и без них
    }
  })
}
