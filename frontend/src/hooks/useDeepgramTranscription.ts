import { useCallback, useEffect, useRef, useState } from 'react'
import { integrationsApi } from '@/api/integrations'
import { getErrorCode, getErrorStatus } from '@/lib/errorMessage'

const DEEPGRAM_WS = 'wss://api.deepgram.com/v1/listen'
const MAX_BUFFER_BYTES = 16000 * 2 * 5 * 60
const MAX_RECONNECT_ATTEMPTS = 10
const SLOW_RETRY_DELAY_MS = 30000

export type CaptureSource = 'system' | 'mic'

interface Options {
  /** Язык распознавания (ru / kk / en). `multi` не покрывает казахский. */
  language: string
  onFinal: (text: string, speaker: string | null, timestamp: string) => void | Promise<void>
  onInterim: (text: string, speaker?: string | null) => void
  onError: (msg: string) => void
  onAudioLevel?: (level: number) => void
  onAudioStatus?: (status: string) => void
  onSourceStopped?: () => void
  onVisibilityChange?: (hidden: boolean) => void
  onBackupStreamReady?: (stream: MediaStream) => void
  /** Сокет распознавания закрылся (для диагностики: код и причина). */
  onSocketClosed?: (code: number, reason: string) => void
  /**
   * Уровни звука по источникам, ~5 раз в секунду: собеседник (вкладка встречи)
   * и ментор (микрофон). null — источника нет в этой записи.
   */
  onLevels?: (levels: { meeting: number | null; mic: number | null }) => void
  /** Записываем звонок, но микрофон не дали — голос ментора в запись не попадёт. */
  onMicUnavailable?: (reason: string) => void
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
  // Микрофон ментора в режиме «звонок»: вкладка встречи отдаёт только голос
  // собеседника, поэтому свой голос подмешиваем отдельно.
  const micStreamRef = useRef<MediaStream | null>(null)
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sourceMutedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    if (audioWatchdogRef.current) clearInterval(audioWatchdogRef.current)
    if (sourceMutedTimerRef.current) clearTimeout(sourceMutedTimerRef.current)
    audioWatchdogRef.current = null
    sourceMutedTimerRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    workletRef.current?.disconnect()
    workletRef.current = null
    audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    if (levelTimerRef.current) clearInterval(levelTimerRef.current)
    levelTimerRef.current = null
    callbacksRef.current.onLevels?.({ meeting: null, mic: null })
    audioBufferRef.current = []
    bufferedBytesRef.current = 0
    setIsConnected(false)
    setIsCapturing(false)
    setCaptureSource(null)
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
        language: callbacksRef.current.language || 'ru',
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
      // Временный JWT из /v1/auth/grant идёт по схеме Bearer — так же делает
      // официальный SDK Deepgram. Со схемой 'token' Deepgram отклоняет JWT.
      const ws = new WebSocket(`${DEEPGRAM_WS}?${params}`, ['bearer', access_token])
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
        callbacksRef.current.onSocketClosed?.(event.code, event.reason)
        if (wsRef.current === ws) wsRef.current = null
        openingRef.current = false
        setIsConnected(false)
        if (keepAliveRef.current) clearInterval(keepAliveRef.current)
        keepAliveRef.current = null
        if (!activeRef.current || manualStopRef.current) return
        reconnectAttemptRef.current += 1
        if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
          // Give up on fast retries, but DO NOT release the mic/screen capture —
          // audio keeps buffering locally (bounded by MAX_BUFFER_BYTES) and the
          // backup recorder keeps writing, so nothing is lost even if this
          // outage lasts a while. Keep retrying slowly forever instead of
          // failing permanently.
          callbacksRef.current.onAudioStatus?.(
            'Не удаётся восстановить распознавание · звук пишется локально, повтор каждые 30 сек',
          )
          reconnectTimerRef.current = setTimeout(() => void openSocketRef.current(), SLOW_RETRY_DELAY_MS)
          return
        }
        const delay = Math.min(30000, 750 * 2 ** (reconnectAttemptRef.current - 1))
        callbacksRef.current.onAudioStatus?.(`Соединение прервано · повтор через ${Math.ceil(delay / 1000)} сек`)
        reconnectTimerRef.current = setTimeout(() => void openSocketRef.current(), delay)
      }
    } catch (error) {
      openingRef.current = false
      if (!activeRef.current || manualStopRef.current) return
      // Повторы бессмысленны, если ключ не настроен или у пользователя нет
      // права на распознавание, — говорим об этом сразу, а не крутим
      // «Подключаем…» бесконечно. Сбой выпуска токена (503) — повторяем.
      if (getErrorCode(error) === 'DEEPGRAM_NOT_CONFIGURED') {
        callbacksRef.current.onError('__DG_NOT_CONFIGURED__')
        return
      }
      if (getErrorStatus(error) === 403) {
        callbacksRef.current.onError('__DG_FORBIDDEN__')
        return
      }
      reconnectAttemptRef.current += 1
      if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
        callbacksRef.current.onAudioStatus?.(
          'Сервис недоступен · звук пишется локально, повтор каждые 30 сек',
        )
        reconnectTimerRef.current = setTimeout(() => void openSocketRef.current(), SLOW_RETRY_DELAY_MS)
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
      const message = (error as DOMException).message || ''
      if (name === 'NotAllowedError' && source === 'system') {
        // Chrome: «Permission denied by system» — запрет ОС (macOS «Запись
        // экрана»); просто «Permission denied» — ментор закрыл окно выбора.
        callbacksRef.current.onError(/system/i.test(message) ? '__SCREEN_PERMISSION_SYSTEM__' : '__CAPTURE_CANCELLED__')
      } else if (name === 'NotAllowedError') callbacksRef.current.onError('Доступ к микрофону запрещён. Разрешите его в настройках браузера.')
      else if (name === 'NotReadableError') callbacksRef.current.onError('__MIC_BUSY__')
      else callbacksRef.current.onError(`Ошибка захвата: ${name || (error as Error).message}`)
      return
    }

    let micStream: MediaStream | null = null
    if (source === 'system') {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          // Эхоподавление обязательно: иначе голос собеседника из колонок
          // попадёт в микрофон и задвоится в тексте. Надёжнее всего — наушники.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch (error) {
        const name = (error as DOMException).name
        callbacksRef.current.onMicUnavailable?.(
          name === 'NotReadableError'
            ? 'Микрофон занят другим приложением — ваш голос не попадёт в запись.'
            : 'Нет доступа к микрофону — запишем только собеседника. Разрешите микрофон в адресной строке, чтобы записать и себя.',
        )
      }
    }

    streamRef.current = stream
    micStreamRef.current = micStream
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
      // Keep the captured signal at its original level. Boosting meeting audio
      // caused clipping before PCM conversion and made speech sound distorted.
      capturedGain.gain.value = 1
      capturedSource.connect(capturedGain).connect(worklet)

      // Mixed-down destination for the local backup recording (safety net) —
      // same mix that's being sent to Deepgram, exposed so the caller can
      // feed it into a MediaRecorder without a second getUserMedia/
      // getDisplayMedia prompt.
      const backupDest = audioCtx.createMediaStreamDestination()
      capturedGain.connect(backupDest)

      // Голос ментора: подмешиваем микрофон в тот же моно-поток для Deepgram
      // и в резервную запись (вход worklet суммирует оба источника).
      const capturedAnalyser = audioCtx.createAnalyser()
      capturedAnalyser.fftSize = 1024
      capturedGain.connect(capturedAnalyser)
      let micAnalyser: AnalyserNode | null = null
      if (micStream) {
        const micSource = audioCtx.createMediaStreamSource(micStream)
        const micGain = audioCtx.createGain()
        micGain.gain.value = 1
        micSource.connect(micGain)
        micGain.connect(worklet)
        micGain.connect(backupDest)
        micAnalyser = audioCtx.createAnalyser()
        micAnalyser.fftSize = 1024
        micGain.connect(micAnalyser)
      }
      callbacksRef.current.onBackupStreamReady?.(backupDest.stream)

      const readLevel = (analyser: AnalyserNode) => {
        const buffer = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buffer)
        return rms(buffer)
      }
      levelTimerRef.current = setInterval(() => {
        if (!activeRef.current) return
        const capturedLevel = readLevel(capturedAnalyser)
        callbacksRef.current.onLevels?.(
          source === 'system'
            ? { meeting: capturedLevel, mic: micAnalyser ? readLevel(micAnalyser) : null }
            : { meeting: null, mic: capturedLevel },
        )
      }, 200)

      const silent = audioCtx.createGain()
      silent.gain.value = 0
      worklet.connect(silent).connect(audioCtx.destination)
      await audioCtx.resume()

      const audioTrack = stream.getAudioTracks()[0]
      const resumeAudioProcessing = () => {
        const currentContext = audioCtxRef.current
        if (!activeRef.current || !currentContext || currentContext.state !== 'suspended') return
        currentContext.resume().then(() => {
          if (activeRef.current && currentContext.state === 'running') {
            callbacksRef.current.onAudioStatus?.('Звук встречи подключён')
          }
        }).catch(() => {
          callbacksRef.current.onAudioStatus?.('Браузер приостановил звук · пытаемся восстановить')
        })
      }

      // A display stream also contains a video track because browsers require
      // getDisplayMedia({ video: true }). That video track may end or be
      // replaced when the shared tab/window changes. It is irrelevant to
      // transcription, so only the audio track is allowed to stop recording.
      audioTrack.addEventListener('ended', () => {
        if (!activeRef.current) return
        if (source === 'mic') {
          // Browsers don't re-prompt for mic permission within the same page,
          // so a dropped mic track can be silently re-acquired — no need to
          // make the user notice and click Start again.
          fullCleanup()
          void startRef.current?.(source, deviceId)
          return
        }
        callbacksRef.current.onSourceStopped?.()
        fullCleanup()
      })
      audioTrack.addEventListener('mute', () => {
        if (!activeRef.current) return
        if (sourceMutedTimerRef.current) clearTimeout(sourceMutedTimerRef.current)
        // Chrome can briefly mute a captured tab while focus/surfaces switch.
        // Treat that as recoverable and avoid the destructive "stopped" state.
        sourceMutedTimerRef.current = setTimeout(() => {
          if (activeRef.current && audioTrack.muted && audioTrack.readyState === 'live') {
            callbacksRef.current.onAudioStatus?.('Источник временно без звука · запись продолжится автоматически')
          }
        }, 1500)
      })
      audioTrack.addEventListener('unmute', () => {
        if (sourceMutedTimerRef.current) clearTimeout(sourceMutedTimerRef.current)
        sourceMutedTimerRef.current = null
        callbacksRef.current.onAudioStatus?.('Звук встречи восстановлен')
        resumeAudioProcessing()
      })
      audioCtx.onstatechange = () => {
        if (!activeRef.current) return
        if (audioCtx.state === 'suspended') {
          callbacksRef.current.onAudioStatus?.('Браузер приостановил обработку звука · восстанавливаем')
          resumeAudioProcessing()
        }
      }
      audioWatchdogRef.current = setInterval(resumeAudioProcessing, 2000)
      void openSocketRef.current()
    } catch (error) {
      callbacksRef.current.onError(`Не удалось запустить аудиопроцессор: ${(error as Error).message}`)
      fullCleanup()
    }
  }, [fullCleanup, queueOrSend])

  const startRef = useRef(start)
  startRef.current = start

  /** Подключиться к распознаванию заново сейчас, не дожидаясь таймера повтора. */
  const retryNow = useCallback(() => {
    if (!activeRef.current) return
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
    reconnectAttemptRef.current = 0
    void openSocketRef.current()
  }, [])

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
    const resumeAudioProcessing = () => {
      if (!activeRef.current || audioCtxRef.current?.state !== 'suspended') return
      audioCtxRef.current.resume().catch(() => undefined)
    }
    const onVisibility = () => {
      callbacksRef.current.onVisibilityChange?.(document.visibilityState === 'hidden')
      // Try on both transitions: Chromium sometimes suspends immediately after
      // the tab becomes hidden; focus/pageshow cover OS window switches.
      resumeAudioProcessing()
    }
    const onFocus = () => resumeAudioProcessing()
    const onPageShow = () => resumeAudioProcessing()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
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
    retryNow,
  }
}
