import { useCallback, useEffect, useRef, useState } from 'react'
import { integrationsApi } from '@/api/integrations'

const DEEPGRAM_WS = 'wss://api.deepgram.com/v1/listen'
const MAX_BUFFER_BYTES = 16000 * 2 * 5 * 60
const MAX_RECONNECT_ATTEMPTS = 10

export type CaptureSource = 'system' | 'mic'

interface Options {
  onFinal: (text: string, speaker: string | null, timestamp: string) => void | Promise<void>
  onInterim: (text: string, speaker?: string | null) => void
  onError: (msg: string) => void
  onAudioLevel?: (level: number) => void
  onAudioStatus?: (status: string) => void
  onSourceStopped?: () => void
  onVisibilityChange?: (hidden: boolean) => void
}

interface DeepgramWord {
  word: string
  speaker?: number
}

interface DeepgramResult {
  type: string
  is_final: boolean
  channel: { alternatives: Array<{ transcript: string; words: DeepgramWord[] }> }
}

function float32ToInt16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return out.buffer
}

function rms(input: Float32Array) {
  let sum = 0
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i]
  return Math.sqrt(sum / Math.max(input.length, 1))
}

function dominantSpeaker(words: DeepgramWord[]): string | null {
  if (!words?.length) return null
  const counts = new Map<number, number>()
  words.forEach((word) => counts.set(word.speaker ?? 0, (counts.get(word.speaker ?? 0) || 0) + 1))
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return top === undefined ? null : `Спикер ${top + 1}`
}

export const hasDeepgramKey = true

export function useDeepgramTranscription(options: Options) {
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const [isConnected, setIsConnected] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureSource, setCaptureSource] = useState<CaptureSource | null>(null)

  const activeRef = useRef(false)
  const manualStopRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const openingRef = useRef(false)
  const audioBufferRef = useRef<ArrayBuffer[]>([])
  const bufferedBytesRef = useRef(0)

  const clearSocketTimers = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current)
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    keepAliveRef.current = null
    reconnectTimerRef.current = null
  }, [])

  const fullCleanup = useCallback(() => {
    activeRef.current = false
    openingRef.current = false
    clearSocketTimers()
    wsRef.current?.close()
    wsRef.current = null
    workletRef.current?.disconnect()
    workletRef.current = null
    audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    micStreamRef.current = null
    audioBufferRef.current = []
    bufferedBytesRef.current = 0
    setIsConnected(false)
    setIsCapturing(false)
    setCaptureSource(null)
    callbacksRef.current.onInterim('')
    callbacksRef.current.onAudioLevel?.(0)
    callbacksRef.current.onAudioStatus?.('')
  }, [clearSocketTimers])

  const queueOrSend = useCallback((buffer: ArrayBuffer) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(buffer)
      return
    }
    audioBufferRef.current.push(buffer)
    bufferedBytesRef.current += buffer.byteLength
    while (bufferedBytesRef.current > MAX_BUFFER_BYTES && audioBufferRef.current.length) {
      bufferedBytesRef.current -= audioBufferRef.current.shift()!.byteLength
    }
  }, [])

  const openSocketRef = useRef<() => Promise<void>>(async () => undefined)
  openSocketRef.current = async () => {
    if (!activeRef.current || openingRef.current) return
    openingRef.current = true
    callbacksRef.current.onAudioStatus?.(
      reconnectAttemptRef.current ? `Переподключение ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}…` : 'Подключение к распознаванию…',
    )
    try {
      const { access_token } = await integrationsApi.getDeepgramToken()
      if (!activeRef.current) return
      const params = new URLSearchParams({
        model: 'nova-3',
        language: 'multi',
        punctuate: 'true',
        smart_format: 'true',
        interim_results: 'true',
        endpointing: '100',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        utterance_end_ms: '1000',
        filler_words: 'false',
        diarize: 'true',
      })
      const ws = new WebSocket(`${DEEPGRAM_WS}?${params}`, ['token', access_token])
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        if (!activeRef.current) {
          ws.close()
          return
        }
        openingRef.current = false
        reconnectAttemptRef.current = 0
        setIsConnected(true)
        callbacksRef.current.onAudioStatus?.('Распознавание подключено')
        const buffered = audioBufferRef.current
        audioBufferRef.current = []
        bufferedBytesRef.current = 0
        buffered.forEach((chunk) => ws.readyState === WebSocket.OPEN && ws.send(chunk))
        if (keepAliveRef.current) clearInterval(keepAliveRef.current)
        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }))
        }, 4000)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as DeepgramResult
          if (data.type !== 'Results') return
          const alternative = data.channel?.alternatives?.[0]
          if (!alternative?.transcript?.trim()) return
          const speaker = dominantSpeaker(alternative.words)
          if (data.is_final) {
            void callbacksRef.current.onFinal(alternative.transcript.trim(), speaker, new Date().toISOString())
            callbacksRef.current.onInterim('')
          } else {
            callbacksRef.current.onInterim(alternative.transcript, speaker)
          }
        } catch {
          // ignore malformed provider frames
        }
      }

      ws.onerror = () => callbacksRef.current.onAudioStatus?.('Сеть нестабильна · сохраняю аудио для переподключения')
      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null
        openingRef.current = false
        setIsConnected(false)
        if (keepAliveRef.current) clearInterval(keepAliveRef.current)
        keepAliveRef.current = null
        if (!activeRef.current || manualStopRef.current) return
        reconnectAttemptRef.current += 1
        if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
          callbacksRef.current.onError(`Не удалось восстановить распознавание (код ${event.code}).`)
          fullCleanup()
          return
        }
        const delay = Math.min(30000, 750 * 2 ** (reconnectAttemptRef.current - 1))
        callbacksRef.current.onAudioStatus?.(`Соединение прервано · повтор через ${Math.ceil(delay / 1000)} сек`)
        reconnectTimerRef.current = setTimeout(() => void openSocketRef.current(), delay)
      }
    } catch (error) {
      openingRef.current = false
      if (!activeRef.current || manualStopRef.current) return
      reconnectAttemptRef.current += 1
      if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
        callbacksRef.current.onError((error as Error).message || 'Не удалось восстановить распознавание')
        fullCleanup()
        return
      }
      const delay = Math.min(30_000, 750 * 2 ** (reconnectAttemptRef.current - 1))
      callbacksRef.current.onAudioStatus?.(`Сервис недоступен · повтор через ${Math.ceil(delay / 1000)} сек`)
      reconnectTimerRef.current = setTimeout(() => void openSocketRef.current(), delay)
    }
  }

  const start = useCallback(async (source: CaptureSource, deviceId?: string) => {
    manualStopRef.current = true
    fullCleanup()
    manualStopRef.current = false

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    if (source === 'system' && isSafari) {
      callbacksRef.current.onError('__SAFARI__')
      return
    }

    let stream: MediaStream
    try {
      stream = source === 'system'
        ? await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
          })
        : await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            },
          })
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop())
        callbacksRef.current.onError('__NO_AUDIO__')
        return
      }
    } catch (error) {
      const name = (error as DOMException).name
      if (name === 'NotAllowedError') callbacksRef.current.onError('Доступ к звуку запрещён. Разрешите его в браузере.')
      else if (name === 'NotReadableError') callbacksRef.current.onError('__MIC_BUSY__')
      else callbacksRef.current.onError(`Ошибка захвата: ${name || (error as Error).message}`)
      return
    }

    streamRef.current = stream
    activeRef.current = true
    setIsCapturing(true)
    setCaptureSource(source)

    try {
      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx
      await audioCtx.audioWorklet.addModule('/pcm-processor.js')
      const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor')
      workletRef.current = worklet
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        callbacksRef.current.onAudioLevel?.(rms(event.data))
        queueOrSend(float32ToInt16(event.data))
      }

      const capturedSource = audioCtx.createMediaStreamSource(stream)
      const capturedGain = audioCtx.createGain()
      capturedGain.gain.value = source === 'system' ? 2.2 : 1
      capturedSource.connect(capturedGain).connect(worklet)

      if (source === 'system') {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
          if (activeRef.current) {
            micStreamRef.current = mic
            const micGain = audioCtx.createGain()
            micGain.gain.value = 1.15
            audioCtx.createMediaStreamSource(mic).connect(micGain).connect(worklet)
          } else {
            mic.getTracks().forEach((track) => track.stop())
          }
        } catch {
          callbacksRef.current.onAudioStatus?.('Системный звук включён · микрофон недоступен')
        }
      }

      const silent = audioCtx.createGain()
      silent.gain.value = 0
      worklet.connect(silent).connect(audioCtx.destination)
      await audioCtx.resume()

      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        if (!activeRef.current) return
        fullCleanup()
        callbacksRef.current.onSourceStopped?.()
      }))
      void openSocketRef.current()
    } catch (error) {
      callbacksRef.current.onError(`Не удалось запустить аудиопроцессор: ${(error as Error).message}`)
      fullCleanup()
    }
  }, [fullCleanup, queueOrSend])

  const stop = useCallback(async () => {
    manualStopRef.current = true
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CloseStream' }))
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    fullCleanup()
  }, [fullCleanup])

  useEffect(() => {
    const onVisibility = () => {
      callbacksRef.current.onVisibilityChange?.(document.visibilityState === 'hidden')
      if (document.visibilityState !== 'hidden' && audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => () => {
    manualStopRef.current = true
    fullCleanup()
  }, [fullCleanup])

  return {
    isConnected,
    isCapturing,
    captureSource,
    start,
    stop,
  }
}
