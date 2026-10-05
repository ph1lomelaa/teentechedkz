export function getErrorMessage(error: unknown, fallback = 'Попробуйте повторить действие') {
  const responseDetail = (
    error as {
      response?: {
        data?: {
          detail?: unknown
          message?: unknown
        }
      }
    }
  ).response?.data

  const detail = responseDetail?.detail ?? responseDetail?.message
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) return detail.map((item) => item?.msg ?? String(item)).join('; ')
  // Массовые операции отвечают объектом `{message, skipped: [{reason}]}`
  // (tasks.py → BULK_ASSIGN_EMPTY). Без этой ветки человек видел только
  // «Request failed with status code 422», а причина отказа терялась.
  if (detail && typeof detail === 'object') {
    const { message: summary, skipped } = detail as { message?: unknown; skipped?: unknown }
    const reasons = Array.isArray(skipped)
      ? [...new Set(skipped.map((item) => (item as { reason?: unknown })?.reason).filter((r): r is string => typeof r === 'string' && !!r.trim()))]
      : []
    if (typeof summary === 'string' && summary.trim()) {
      return reasons.length ? `${summary}: ${reasons.join('; ')}` : summary
    }
    if (reasons.length) return reasons.join('; ')
  }

  const message = (error as Error | undefined)?.message
  if (message && message !== 'Network Error') return message
  if (message === 'Network Error') return 'Нет связи с сервером. Проверьте интернет и повторите действие.'
  return fallback
}

/**
 * HTTP-код ответа, если ошибка пришла от сервера.
 *
 * Нужен там, где разные коды означают для человека разное. Карточка студента
 * показывала «Студент не найден» на любую ошибку — и на 500, и на обрыв связи;
 * сотрудник шёл искать несуществующую проблему в данных вместо того, чтобы
 * повторить запрос. Отличить «нет такого» от «не смогли спросить» можно только
 * по коду.
 */
export function getErrorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | undefined)?.response?.status
}

/**
 * Машинный код ошибки приложения (X-Error-Code / поле `code` в теле ответа).
 *
 * Текст `detail` может поменяться, а код — контракт: по нему фронт решает,
 * повторять ли запрос или сразу показать человеку причину.
 */
export function getErrorCode(error: unknown): string | undefined {
  const response = (error as {
    response?: { data?: { code?: unknown }; headers?: Record<string, unknown> }
  } | undefined)?.response
  const code = response?.data?.code ?? response?.headers?.['x-error-code']
  return typeof code === 'string' ? code : undefined
}
