/**
 * The WebSocket carries its token in the query string, so an expired token is
 * rejected at the handshake (HTTP 403) and never reaches the axios refresh
 * interceptor. Before this, `scheduleReconnect` retried on a flat 3s timer
 * forever — an expired token produced a permanent reconnect loop (~1200
 * rejected handshakes/hour in the backend logs).
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const refreshAccessToken = vi.fn(async (): Promise<string | null> => null)

vi.mock('@/api/client', () => ({
  API_BASE: 'http://localhost:8001',
  getAccessToken: () => 'stale-token',
  refreshAccessToken: () => refreshAccessToken(),
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  close() {}
  /** Simulate the server rejecting the handshake (403 → immediate close). */
  reject() {
    this.readyState = 3
    this.onclose?.()
  }
  accept() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
}

describe('ws reconnect backoff', () => {
  let ws: typeof import('./ws').ws

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeWebSocket.instances = []
    refreshAccessToken.mockReset()
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    ws = (await import('./ws')).ws
  })

  afterEach(() => {
    ws.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('backs off instead of retrying on a flat timer', async () => {
    refreshAccessToken.mockResolvedValue('fresh-token')
    ws.start()
    expect(FakeWebSocket.instances).toHaveLength(1)

    FakeWebSocket.instances[0].reject()
    // First retry waits the base delay; it must not fire earlier.
    await vi.advanceTimersByTimeAsync(2999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(2)

    // Second failure must wait longer than the first (exponential, not flat).
    FakeWebSocket.instances[1].reject()
    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('refreshes the token after repeated handshake failures', async () => {
    refreshAccessToken.mockResolvedValue('fresh-token')
    ws.start()
    FakeWebSocket.instances[0].reject()
    await vi.advanceTimersByTimeAsync(3000)
    FakeWebSocket.instances[1].reject()
    await vi.advanceTimersByTimeAsync(6000)

    expect(refreshAccessToken).toHaveBeenCalled()
  })

  it('stops reconnecting when the session is gone', async () => {
    refreshAccessToken.mockResolvedValue(null) // refresh failed → logged out
    ws.start()
    FakeWebSocket.instances[0].reject()
    await vi.advanceTimersByTimeAsync(3000)
    FakeWebSocket.instances[1].reject()
    await vi.advanceTimersByTimeAsync(6000)

    const countAfterGiveUp = FakeWebSocket.instances.length
    // Well past several would-be retries — nothing further may be attempted.
    await vi.advanceTimersByTimeAsync(120000)
    expect(FakeWebSocket.instances).toHaveLength(countAfterGiveUp)
  })

  it('resets the backoff once a handshake succeeds', async () => {
    refreshAccessToken.mockResolvedValue('fresh-token')
    ws.start()
    FakeWebSocket.instances[0].reject()
    await vi.advanceTimersByTimeAsync(3000)
    FakeWebSocket.instances[1].accept()

    // After a good connection, a later drop retries at the base delay again.
    FakeWebSocket.instances[1].onclose?.()
    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })
})
