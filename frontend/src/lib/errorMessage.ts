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
