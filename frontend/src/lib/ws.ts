import { useEffect, useRef } from 'react'
import { API_BASE, getAccessToken, refreshAccessToken } from '@/api/client'

type Handler = (data: unknown) => void

const listeners: Record<string, Set<Handler>> = {}
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let shouldConnect = false
// The token travels in the query string, so an expired one is rejected at the
// handshake (403) and never reaches the axios refresh interceptor. Without
// backoff that turns into a reconnect attempt every 3s forever — thousands of
// rejected handshakes an hour once the access token ages out.
let attempts = 0
let refreshing = false
const BASE_DELAY_MS = 3000
const MAX_DELAY_MS = 60000
const REFRESH_AFTER_ATTEMPTS = 2

function wsUrl(): string {
  const token = getAccessToken() || ''
  const base = API_BASE.replace(/^http/, 'ws')
  return `${base}/api/v1/ws?token=${encodeURIComponent(token)}`
}

function open() {
  if (!shouldConnect) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  try {
    socket = new WebSocket(wsUrl())
  } catch {
    scheduleReconnect()
    return
  }
  socket.onopen = () => {
    // A completed handshake means the token was accepted — reset the backoff.
    attempts = 0
  }
  socket.onmessage = (e) => {
    try {
      const { event, data } = JSON.parse(e.data)
      listeners[event]?.forEach((h) => h(data))
    } catch {
      /* ignore malformed frames */
    }
  }
  socket.onclose = () => {
    socket = null
    scheduleReconnect()
  }
  socket.onerror = () => {
    try {
      socket?.close()
    } catch {
      /* noop */
    }
  }
}

function scheduleReconnect() {
  if (!shouldConnect || reconnectTimer) return
  attempts += 1
  const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS)
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if (!shouldConnect) return
    // Repeated failures usually mean the access token expired while the tab
    // sat idle. Refresh once before retrying; if the session is really gone,
    // stop instead of reconnecting forever — the axios layer handles the
    // redirect to /login on the next real request.
    if (attempts >= REFRESH_AFTER_ATTEMPTS && !refreshing) {
      refreshing = true
      try {
        const token = await refreshAccessToken()
        if (!token) {
          shouldConnect = false
          return
        }
      } finally {
        refreshing = false
      }
    }
    open()
  }, delay)
}

export const ws = {
  start() {
    // Also clears a shouldConnect=false set by a give-up above, so a fresh
    // login (or a new subscriber) revives the socket.
    shouldConnect = true
    attempts = 0
    open()
  },
  stop() {
    shouldConnect = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket) {
      try {
        socket.close()
      } catch {
        /* noop */
      }
      socket = null
    }
  },
  on(event: string, handler: Handler): () => void {
    const eventListeners = (listeners[event] ??= new Set())
    eventListeners.add(handler)
    // Deliberately not ws.start(): components subscribe on every mount, and
    // resetting the backoff counter here would undo it during normal
    // navigation and restore the tight reconnect loop.
    if (shouldConnect) {
      open()
    } else if (attempts === 0) {
      ws.start()
    }
    return () => {
      listeners[event]?.delete(handler)
    }
  },
}

/** Subscribe a component to a server-pushed WebSocket event. */
export function useWsEvent(event: string, handler: Handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const unsub = ws.on(event, (d) => ref.current(d))
    return unsub
  }, [event])
}
