import { useEffect, useRef } from 'react'
import { API_BASE, getAccessToken } from '@/api/client'

type Handler = (data: unknown) => void

const listeners: Record<string, Set<Handler>> = {}
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let shouldConnect = false

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
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    open()
  }, 3000)
}

export const ws = {
  start() {
    shouldConnect = true
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
    ws.start()
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
