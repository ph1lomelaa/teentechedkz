/**
 * Классы оболочки для админ-разделов (регламенты, ОКК МЗК, вознаграждения).
 *
 * Эти страницы монтируются и в воркспейсе (`w`), и в CRM (`ds`), поэтому имена
 * классов нельзя собирать шаблонной строкой: Tailwind сканирует исходники
 * статически и `text-${c}-ink` в сборку просто не попадёт. Отсюда явные карты —
 * ровно та же техника, что в components/ui/*.
 *
 * Наборы `w` и `ds` не зеркальны (у `ds` акцент называется accent-dim, у `w` —
 * accentDim), поэтому карта, а не склейка префикса с суффиксом.
 */
export type AdminColorPrefix = 'w' | 'ds'

interface AdminTokens {
  ink: string
  muted: string
  muted2: string
  line: string
  borderLine: string
  panel: string
  panel2: string
  accentText: string
  good: string
  danger: string
  dangerHover: string
  dangerSoftBg: string
  /** Основная поверхность-карточка. */
  card: string
  /** Вложенная строка внутри карточки. */
  row: string
}

export const ADMIN_TOKENS: Record<AdminColorPrefix, AdminTokens> = {
  w: {
    ink: 'text-w-ink',
    muted: 'text-w-muted',
    muted2: 'text-w-muted2',
    line: 'bg-w-line',
    borderLine: 'border-w-line',
    panel: 'bg-w-panel',
    panel2: 'bg-w-panel2',
    accentText: 'text-w-accentText',
    good: 'text-w-good',
    danger: 'text-w-danger',
    dangerHover: 'hover:text-w-danger',
    dangerSoftBg: 'bg-w-danger/15',
    card: 'rounded-card border border-w-line bg-w-panel',
    row: 'rounded-panel border border-w-line bg-w-panel2',
  },
  ds: {
    ink: 'text-ds-ink',
    muted: 'text-ds-muted',
    muted2: 'text-ds-muted2',
    line: 'bg-ds-line',
    borderLine: 'border-ds-line',
    panel: 'bg-ds-panel',
    panel2: 'bg-ds-panel2',
    accentText: 'text-ds-accentText',
    good: 'text-ds-good',
    danger: 'text-ds-danger',
    dangerHover: 'hover:text-ds-danger',
    dangerSoftBg: 'bg-ds-danger/15',
    card: 'rounded-card border border-ds-line bg-ds-panel',
    row: 'rounded-panel border border-ds-line bg-ds-panel2',
  },
}
