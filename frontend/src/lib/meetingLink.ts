/**
 * Ссылка на встречу: '' (не задана), рабочая http(s)-ссылка или null (мусор).
 * «zoom.us/j/1» без схемы дополняем до https. Та же логика, что в
 * backend/app/schemas/meeting.py: иначе «ss» открывается как путь внутри самой
 * системы и уводит ментора на случайную страницу вместо встречи.
 */
export function normalizeMeetingLink(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  if (/\s/.test(raw)) return null
  const full = raw.includes('://') ? raw : `https://${raw}`
  try {
    const url = new URL(full)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return full
  } catch {
    return null
  }
}
