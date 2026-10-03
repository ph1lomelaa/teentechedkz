import type { AccessRequestItem, BulkApproveResult } from '@/api/accessRequests'
import { getErrorMessage, getErrorStatus } from '@/lib/errorMessage'
import { formatDate } from '@/lib/utils'

export const RECENT_LOGIN_DAYS = 30

/** Заходил ли пользователь меньше RECENT_LOGIN_DAYS дней назад. */
export function isRecentLogin(lastLogin: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastLogin) return false
  const t = new Date(lastLogin).getTime()
  return Number.isFinite(t) && now - t < RECENT_LOGIN_DAYS * 24 * 3600 * 1000
}

export interface ReplaceTarget {
  item: AccessRequestItem
  studentId: string
  studentName: string
  ownerEmail: string | null
  /** undefined — неизвестно (карточку выбрали поиском), null — ни разу не входил. */
  ownerLastLogin?: string | null
}

export interface ReplaceText {
  description: string
  recent: boolean
  confirmLabel: string
}

/** Текст окна замены кабинета. Недавний вход делает кнопку красной и громче. */
export function replaceConfirmText(target: ReplaceTarget, now: number = Date.now()): ReplaceText {
  const recent = isRecentLogin(target.ownerLastLogin, now)
  const owner = target.ownerEmail ? `: ${target.ownerEmail}` : ''
  const login =
    target.ownerLastLogin === undefined
      ? ''
      : target.ownerLastLogin === null
        ? ', ни разу не входил'
        : `, последний вход ${formatDate(target.ownerLastLogin)}`
  return {
    description:
      `У карточки уже есть кабинет${owner}${login}. Старый аккаунт будет отключён, ` +
      `новый (${target.item.user.email}) будет прикреплён к карточке ${target.studentName}. Продолжить?`,
    recent,
    confirmLabel: recent ? 'Всё равно заменить' : 'Заменить',
  }
}

export function closeLinkedText(cardName: string | null): string {
  return (
    `Аккаунт уже привязан к карточке${cardName ? ` ${cardName}` : ''}. ` +
    'Закрыть заявку? Аккаунты не изменятся.'
  )
}

export interface BulkRow {
  id: string
  name: string
  phone: string
  cardName: string
}

export interface BulkFailure {
  id: string
  name: string
  reason: string
}

export interface BulkSummary {
  kind: 'success' | 'partial' | 'failed'
  ok: number
  failed: BulkFailure[]
  headline: string
}

function headline(ok: number, failed: number): BulkSummary['kind'] {
  if (failed === 0) return 'success'
  return ok === 0 ? 'failed' : 'partial'
}

function makeSummary(ok: number, failed: BulkFailure[]): BulkSummary {
  const kind = headline(ok, failed.length)
  return {
    kind,
    ok,
    failed,
    headline:
      kind === 'failed' && ok === 0
        ? `Не удалось прикрепить ни одной заявки (${failed.length})`
        : `Успешно: ${ok}. Не удалось: ${failed.length}`,
  }
}

/** Сводка по ответу сервера. Каждая отправленная заявка обязана оказаться
 * либо в успешных, либо в неудачных: «потерянных» без причины не бывает. */
export function summarizeBulk(requested: BulkRow[], result: BulkApproveResult): BulkSummary {
  const names = new Map(requested.map((r) => [r.id, r.name]))
  const approved = new Set(result.approved.map((a) => a.id))
  const failed: BulkFailure[] = result.skipped.map((s) => ({
    id: s.id,
    name: s.name ?? names.get(s.id) ?? 'Заявка',
    reason: s.reason || 'Причина не указана',
  }))
  const seen = new Set([...approved, ...failed.map((f) => f.id)])
  for (const row of requested) {
    if (!seen.has(row.id)) {
      failed.push({ id: row.id, name: row.name, reason: 'Сервер не вернул результат по этой заявке' })
    }
  }
  return makeSummary(approved.size, failed)
}

/** Запрос не дошёл или сервер ответил ошибкой: не удалось всё, причина одна. */
export function summarizeBulkError(requested: BulkRow[], message: string): BulkSummary {
  return makeSummary(
    0,
    requested.map((r) => ({ id: r.id, name: r.name, reason: message })),
  )
}

/** Текст ошибки действия: detail сервера, а на 403 — ещё и про права. */
export function describeActionError(error: unknown): string {
  const detail = getErrorMessage(error, '')
  if (getErrorStatus(error) === 403) {
    return `Нет прав на это действие: одобрять заявки может только администратор.${detail ? ` (${detail})` : ''}`
  }
  return detail || 'Не удалось выполнить действие. Повторите попытку.'
}
