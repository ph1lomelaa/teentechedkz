import type { ExistingUserConflict } from '@/api/portalAccess'

/**
 * Разобрать 409 от «Выдать доступ»: занят ли email уже существующим аккаунтом.
 *
 * Зачем отдельно
 * --------------
 * До появления привязки этот отказ был тупиком: студент, зарегистрировавшийся
 * сам через /join, занимал адрес, и выдать ему кабинет становилось нечем.
 * Теперь сервер отдаёт вместе с отказом сам аккаунт, и обе панели доступа
 * (CRM и кабинет) должны показать одно и то же — поэтому разбор здесь, а не
 * скопирован в каждую.
 *
 * Опознаём по заголовку `X-Error-Code`, а не по тексту: текст меняется при
 * первой же правке формулировки, и проверка по нему тихо перестаёт срабатывать.
 */
export function parseExistingUserConflict(err: unknown): ExistingUserConflict['user'] | null {
  const response = (
    err as {
      response?: {
        status?: number
        headers?: Record<string, string>
        data?: { detail?: unknown }
      }
    }
  ).response
  if (!response || response.status !== 409) return null

  const code = response.headers?.['x-error-code'] ?? response.headers?.['X-Error-Code']
  if (code !== 'USER_EXISTS') return null

  const detail = response.data?.detail as ExistingUserConflict | undefined
  return detail?.user ?? null
}

/**
 * Текст отказа для тоста. Detail у этого 409 — объект, а не строка: отдать его
 * в описание тоста как есть значит уронить рендер.
 */
export function conflictMessage(err: unknown): string | null {
  const response = (err as { response?: { data?: { detail?: unknown } } }).response
  const detail = response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  return null
}
