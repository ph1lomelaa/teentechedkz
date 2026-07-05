export interface PendingTranscript {
  clientSegmentId: string
  text: string
  timestamp: string
  speaker?: string | null
  sequenceNo: number
}

function key(sessionId: string) {
  return `note-session-outbox:${sessionId}`
}

export function createClientSegmentId(sessionId: string) {
  return `${sessionId}:${crypto.randomUUID()}`
}

export function readTranscriptOutbox(sessionId: string): PendingTranscript[] {
  try {
    const raw = window.localStorage.getItem(key(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function enqueueTranscript(sessionId: string, item: PendingTranscript) {
  const current = readTranscriptOutbox(sessionId)
  current.push(item)
  window.localStorage.setItem(key(sessionId), JSON.stringify(current))
}

export function removeTranscriptFromOutbox(sessionId: string, clientSegmentId: string) {
  const current = readTranscriptOutbox(sessionId).filter((item) => item.clientSegmentId !== clientSegmentId)
  window.localStorage.setItem(key(sessionId), JSON.stringify(current))
}
