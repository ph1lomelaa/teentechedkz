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
