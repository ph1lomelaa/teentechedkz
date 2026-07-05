import { useCallback, useEffect, useRef, useState } from 'react'
import { notesApi } from '@/api/notes'

// Rotates the recorder instead of using MediaRecorder's `timeslice` option:
// only the FIRST chunk of a timesliced recording contains the WebM header,
// so later slices aren't independently decodable files on their own. Ending
// and immediately restarting the recorder every 5 minutes gives us a
// sequence of small, self-contained webm/opus files instead — each one is a
// complete file Deepgram's pre-recorded REST API (or any tool) can open by
// itself, and a browser crash loses at most one in-progress segment.
const SEGMENT_ROTATE_MS = 5 * 60 * 1000
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

function pickMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

interface PendingChunk {
  sessionId: string
  chunkIndex: number
  blob: Blob
}

export function useAudioBackupRecorder(sessionId: string) {
  const [segmentCount, setSegmentCount] = useState(0)
  const [uploadedCount, setUploadedCount] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunkIndexRef = useRef(0)
  const activeRef = useRef(false)
  const pendingRef = useRef<PendingChunk[]>([])
  const flushingRef = useRef(false)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const recordingSessionIdRef = useRef(sessionId)

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      while (pendingRef.current.length) {
        const item = pendingRef.current[0]
        try {
          await notesApi.uploadAudioChunk(item.sessionId, item.blob, item.chunkIndex)
          pendingRef.current.shift()
          if (item.sessionId === recordingSessionIdRef.current) {
            setUploadedCount((n) => n + 1)
          }
        } catch {
          // Network/server hiccup — leave it queued in memory and retry on
          // the next timer tick or 'online' event. A full page reload loses
          // whatever hadn't uploaded yet (in-memory queue, not persisted) —
          // acceptable trade-off given a segment is at most 5 minutes.
          break
        }
      }
    } finally {
      flushingRef.current = false
    }
  }, [])

  const enqueue = useCallback((blob: Blob) => {
    if (blob.size === 0) return
    const chunkIndex = chunkIndexRef.current++
    pendingRef.current.push({ sessionId: recordingSessionIdRef.current, chunkIndex, blob })
    setSegmentCount((n) => n + 1)
    void flush()
  }, [flush])

  const startSegment = useCallback(() => {
    const stream = streamRef.current
    if (!stream || !activeRef.current) return
    const mimeType = pickMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      enqueue(blob)
      if (activeRef.current) startSegment()
    }
    recorder.start()
    recorderRef.current = recorder
  }, [enqueue])

  const stop = useCallback(() => {
    activeRef.current = false
    if (rotateTimerRef.current) clearInterval(rotateTimerRef.current)
    rotateTimerRef.current = null
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    recorderRef.current = null
    streamRef.current = null
  }, [])

  const start = useCallback((stream: MediaStream) => {
    if (activeRef.current) stop()
    recordingSessionIdRef.current = sessionIdRef.current
    chunkIndexRef.current = 0
    setSegmentCount(0)
    setUploadedCount(0)
    streamRef.current = stream
    activeRef.current = true
    startSegment()
    rotateTimerRef.current = setInterval(() => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    }, SEGMENT_ROTATE_MS)
  }, [startSegment, stop])

  useEffect(() => {
    const retry = () => void flush()
    window.addEventListener('online', retry)
    const interval = window.setInterval(retry, 10000)
    return () => {
      window.removeEventListener('online', retry)
      window.clearInterval(interval)
    }
  }, [flush])

  useEffect(() => () => stop(), [stop])

  return { segmentCount, uploadedCount, start, stop }
}
