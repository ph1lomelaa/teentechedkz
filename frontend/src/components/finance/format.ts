import type { PaymentMethod, ScheduleKind } from '@/api/finance'
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'

const NBSP = ' '

/** Суммы всегда полностью и с неразрывными пробелами: «1 725 000 ₸». */
export function money(value?: string | number | null, currency = 'KZT'): string {
  if (value === undefined || value === null || value === '') return '—'
  const n = typeof value === 'string' ? Number.parseFloat(value) : value
  if (!Number.isFinite(n)) return '—'
  const digits = Math.round(n).toString().replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return `${n < 0 ? '−' : ''}${digits}${NBSP}${currency === 'KZT' ? '₸' : currency}`
}

export function num(value?: string | number | null): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value ?? 0
  return Number.isFinite(n) ? (n as number) : 0
}

/** Ввод суммы: цифры с разрядами «450 000», без копеек. */
export function formatAmountInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

export function parseAmountInput(text: string): number {
  return Number.parseInt(text.replace(/\D/g, ''), 10) || 0
}

/** Дата по местному времени: toISOString() дал бы вчерашний день до 05:00 по Алматы. */
export function localIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + days)
  return localIso(d)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 86_400_000)
}

/** 01.11.2026 */
export function date(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

/** 01.11.2026, 12:00 */
export function dateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Согласование: plural(1, ['платёж', 'платежа', 'платежей']) → «1 платёж». */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2]
  return `${n}${NBSP}${form}`
}

export const payments = (n: number) => plural(n, ['платёж', 'платежа', 'платежей'])

export const KIND_LABELS: Record<ScheduleKind, string> = {
  main: 'Основной',
  english: 'Английский',
  portfolio: 'Улучшение портфолио',
  proforientation: 'Профориентация',
  ielts_fee: 'Экзамен IELTS',
  other: 'Другое',
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  kaspi: 'Kaspi',
  bank: 'Банк',
  cash: 'Наличные',
  other: 'Другое',
}

export function paymentTitle(item: { kind: ScheduleKind | null; label: string | null }): string {
  if (!item.kind) return item.label || 'Вне графика'
  return item.label ? `${KIND_LABELS[item.kind]} · ${item.label}` : KIND_LABELS[item.kind]
}

export function statusLabel(status?: string | null): string {
  if (!status) return 'Без статуса'
  return PIPELINE_STATUS_LABELS[status as PipelineStatus] ?? status
}

/** Выгрузка таблицы в CSV для Excel: точка с запятой и BOM — иначе русские
 * буквы и разделители колонок Excel читает неверно. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v).replace(/\u00a0/g, ' ')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
