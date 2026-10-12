import { API_BASE, getAccessToken } from '@/api/client'

const knownTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'NotFoundError', 'ChunkLoadError'])
const sent = new Map<string, number>()

/** First-party diagnostics: no error message, student ID, query, or form data. */
export function reportClientRuntimeError(error: Error, componentStack = '', kind: 'render' | 'unhandled' = 'render') {
  const token = getAccessToken()
  if (!token) return
  const pathname = window.location.pathname
  const route = /^\/workspace\/students\/[^/]+$/.test(pathname) ? 'workspace_student_card'
    : /^\/students\/[^/]+$/.test(pathname) ? 'student_card' : 'app'
  const components = [...componentStack.matchAll(/^\s*at\s+([A-Za-z][A-Za-z0-9_.$]{0,79})/gm)]
    .slice(0, 30).map(match => match[1])
  const errorType = knownTypes.has(error.name) ? error.name : 'Error'
  const signature = `${route}:${kind}:${errorType}:${components.join(',')}`
  if (Date.now() - (sent.get(signature) ?? 0) < 60_000) return
  if (sent.size >= 50) sent.clear()
  sent.set(signature, Date.now())
  // Do not use the API interceptor: diagnostic failures must never redirect,
  // refresh credentials, or create another unhandled rejection.
  void fetch(`${API_BASE}/api/v1/auth/client-error`, {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, error_type: errorType, route, components }),
  }).catch(() => {})
}
