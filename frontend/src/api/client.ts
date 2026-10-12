import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

const ENV_API_URL = import.meta.env.VITE_API_URL || ''
const isBrowserLocalhost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
// На localhost бэкенд — это контейнер на :8001. Порт можно сменить, не трогая
// код: VITE_LOCAL_API_PORT=8099 npm run dev (например, на сид-базу).
const LOCAL_API_PORT = import.meta.env.VITE_LOCAL_API_PORT || '8001'
const API_URL =
  isBrowserLocalhost && typeof window !== 'undefined'
    ? `http://${window.location.hostname}:${LOCAL_API_PORT}`
    : ENV_API_URL || 'http://localhost:8000'

// Base origin (without /api/v1) — used to build the WebSocket URL.
export const API_BASE = API_URL

interface ApiRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

export const apiClient = axios.create({
  baseURL: `${API_URL}/api/v1`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

let accessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null

export const setAccessToken = (token: string | null) => {
  accessToken = token
}

export const getAccessToken = () => accessToken

/** Refresh the access token, reusing an in-flight refresh if one is running.
 *  Exported for non-axios consumers (the WebSocket, which carries its token in
 *  the query string and so never passes through the response interceptor).
 *  Returns the new token, or null when the session is truly gone. */
export const refreshAccessToken = (): Promise<string | null> => {
  if (refreshPromise) return refreshPromise
  refreshPromise = axios.post(`${API_URL}/api/v1/auth/refresh`, {}, { withCredentials: true })
    .then(response => {
      const token = response.data.access_token as string
      setAccessToken(token)
      return token
    })
    .catch(error => {
      if (error.response?.status === 401) {
        setAccessToken(null)
        return null
      }
      // Network errors and 5xx do not invalidate a session.
      throw error
    })
    .finally(() => { refreshPromise = null })
  return refreshPromise
}

// A role change made elsewhere (admin editing this user's role) leaves the
// session technically alive but the client's cached role stale — the next
// request that now fails with a role-check 403 is our only signal to go
// re-fetch who this user actually is. AuthProvider registers the handler.
type ForbiddenHandler = () => void
let onForbidden: ForbiddenHandler | null = null
export const setForbiddenHandler = (fn: ForbiddenHandler | null) => {
  onForbidden = fn
}

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as ApiRequestConfig | undefined
    const requestUrl = originalRequest?.url ?? ''
    const isAuthRequest =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/refresh') ||
      requestUrl.includes('/auth/logout')

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isAuthRequest
    ) {
      originalRequest._retry = true
      // A slower card request may carry a token already replaced by another
      // request. Retry with the fresh token instead of rotating the cookie again.
      const sentToken = originalRequest.headers.Authorization
      const token = accessToken && sentToken !== `Bearer ${accessToken}`
        ? accessToken
        : await refreshAccessToken()
      if (!token) {
        if (window.location.pathname !== '/login') window.location.replace('/login')
        return Promise.reject(error)
      }
      originalRequest.headers.Authorization = `Bearer ${token}`
      return apiClient(originalRequest)
    }

    // AGREEMENT_SIGNATURE_REQUIRED — админ опубликовал новую редакцию
    // регламента, пока вкладка была открыта. Тот же перечитанный /auth/me
    // поднимет флаг agreement_signature_required, и роутер сразу уведёт на
    // страницу подписи, а не оставит человека с непонятными ошибками.
    const errorCode = error.response?.headers?.['x-error-code']
    if (
      error.response?.status === 403 &&
      (errorCode === 'FORBIDDEN' || errorCode === 'AGREEMENT_SIGNATURE_REQUIRED')
    ) {
      onForbidden?.()
    }

    return Promise.reject(error)
  }
)

export default apiClient
