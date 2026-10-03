import type { CheckinTimezoneOption } from '@/api/checkins'

/** «Берлин» вместо «Europe/Berlin»; незнакомый пояс показываем как есть. */
export function timezoneLabel(tz: string, options?: CheckinTimezoneOption[]): string {
  return options?.find((o) => o.value === tz)?.label ?? tz
}

/** Текущее время в поясе — для подсказки «сейчас у вас 09:12». */
export function timeIn(tz: string, now: Date = new Date()): string {
  try {
    return now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz })
  } catch {
    return ''
  }
}
