import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  AudioLines,
  Bot,
  Building2,
  Check,
  Loader2,
  Mic,
  MonitorUp,
  RefreshCw,
  Square,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDeepgramTranscription, type CaptureSource } from '@/hooks/useDeepgramTranscription'
import { useAudioBackupRecorder } from '@/hooks/useAudioBackupRecorder'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { NoteSessionDraft, NoteSessionReconcileResult, NoteTranscript } from '@/types'
import {
  createClientSegmentId,
  enqueueTranscript,
  readTranscriptOutbox,
  removeTranscriptFromOutbox,
  type PendingTranscript,
} from '@/utils/transcriptOutbox'
import { getErrorMessage } from '@/lib/errorMessage'

function entryValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function playAlertBeep() {
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.frequency.value = 880
    gain.gain.value = 0.15
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.35)
    oscillator.onended = () => void ctx.close()
  } catch {
    // best-effort — silence is not worth failing the page over
  }
}

function renderPairs(data: Record<string, unknown>) {
  const entries = Object.entries(data)
  if (!entries.length) return <p className="text-sm text-slate-400">Нет данных</p>
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-2 last:border-0 last:pb-0">
          <span className="text-sm text-slate-500">{key}</span>
          <span className="text-sm text-slate-800 text-right whitespace-pre-wrap max-w-[60%]">{entryValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

export const NoteSessionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = id ?? ''

  const [transcripts, setTranscripts] = useState<NoteTranscript[]>([])
  const [interimText, setInterimText] = useState('')
  const [interimSpeaker, setInterimSpeaker] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [audioStatus, setAudioStatus] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState('')
  const [draft, setDraft] = useState<NoteSessionDraft | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [returnedFromBackground, setReturnedFromBackground] = useState(false)
  const [captureSource, setCaptureSource] = useState<CaptureSource | null>(null)
  const [sourceStoppedAlert, setSourceStoppedAlert] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<NoteSessionReconcileResult | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false)

  const audioBackup = useAudioBackupRecorder(sessionId)
  const originalTitleRef = useRef(document.title)
  const titleFlashRef = useRef<number | null>(null)

  const transcriptsRef = useRef<NoteTranscript[]>([])
  const interimRef = useRef('')
  const interimSpeakerRef = useRef<string | null>(null)
  const savingInterimRef = useRef(false)
  const sequenceRef = useRef(0)
  const flushPromiseRef = useRef<Promise<void> | null>(null)

  const { data: session, isLoading, refetch } = useQuery({
    queryKey: ['note-session', sessionId],
    queryFn: () => notesApi.getSession(sessionId),
    enabled: Boolean(sessionId),
  })

  useEffect(() => {
    transcriptsRef.current = transcripts
  }, [transcripts])

  useEffect(() => {
    interimRef.current = interimText
  }, [interimText])

  useEffect(() => {
    interimSpeakerRef.current = interimSpeaker
  }, [interimSpeaker])

  const flushOutbox = useCallback((): Promise<void> => {
    if (flushPromiseRef.current) return flushPromiseRef.current
    const task = (async () => {
      const queued = readTranscriptOutbox(sessionId)
      setPendingCount(queued.length)
      for (const item of queued) {
        try {
          const saved = await notesApi.addTranscript(sessionId, {
            text: item.text,
            timestamp: item.timestamp,
            speaker: item.speaker ?? undefined,
            client_segment_id: item.clientSegmentId,
          })
          removeTranscriptFromOutbox(sessionId, item.clientSegmentId)
          setTranscripts((current) => {
            const index = current.findIndex((entry) => entry.client_segment_id === item.clientSegmentId)
            const next = index >= 0
              ? current.map((entry, position) => position === index ? saved : entry)
              : [...current, saved]
            return next.sort((a, b) => a.sequence_no - b.sequence_no)
          })
          setSyncStatus('')
          setPendingCount(readTranscriptOutbox(sessionId).length)
        } catch (err) {
          console.error('Transcript sync error:', err)
          setSyncStatus('Нет связи с сервером · текст сохранён на этом устройстве')
          break
        }
      }
    })()
    flushPromiseRef.current = task
    void task.finally(() => {
      if (flushPromiseRef.current === task) flushPromiseRef.current = null
    })
    return task
  }, [sessionId])

  const handleFinalResult = useCallback(async (text: string, speaker: string | null, timestamp: string) => {
    const item: PendingTranscript = {
      clientSegmentId: createClientSegmentId(sessionId),
      text: text.trim(),
      timestamp,
      speaker,
      sequenceNo: sequenceRef.current++,
    }
    enqueueTranscript(sessionId, item)
    setPendingCount(readTranscriptOutbox(sessionId).length)
    const optimistic: NoteTranscript = {
      id: `local-${item.sequenceNo}`,
      session_id: sessionId,
      text: item.text,
      timestamp: item.timestamp,
      speaker: item.speaker,
      client_segment_id: item.clientSegmentId,
      sequence_no: item.sequenceNo,
      created_at: timestamp,
    }
    setTranscripts((current) => current.some((entry) => entry.client_segment_id === item.clientSegmentId)
      ? current
      : [...current, optimistic].sort((a, b) => a.sequence_no - b.sequence_no))
    try {
      await flushOutbox()
    } catch {
      // retry happens through the durable outbox
    }
  }, [flushOutbox, sessionId])

  const handleInterim = useCallback((text: string, speaker?: string | null) => {
    interimRef.current = text
    interimSpeakerRef.current = speaker ?? null
    setInterimText(text)
    setInterimSpeaker(speaker ?? null)
  }, [])

  const handleError = useCallback((msg: string) => setError(msg), [])

  const savePendingInterim = useCallback(async () => {
    const text = interimRef.current.trim()
    if (!text || savingInterimRef.current) return
    savingInterimRef.current = true
    try {
      await handleFinalResult(text, interimSpeakerRef.current, new Date().toISOString())
      setInterimText('')
      setInterimSpeaker(null)
      interimRef.current = ''
      interimSpeakerRef.current = null
    } finally {
      savingInterimRef.current = false
    }
  }, [handleFinalResult])

  const deepgram = useDeepgramTranscription({
    onFinal: handleFinalResult,
    onInterim: handleInterim,
    onError: handleError,
    onAudioLevel: setAudioLevel,
    onAudioStatus: setAudioStatus,
    onSourceStopped: () => {
      void savePendingInterim()
      setError('Захват звука остановлен. Сохранённый текст не потерян.')
      setSourceStoppedAlert(true)
      playAlertBeep()
    },
    onVisibilityChange: (hidden) => {
      if (hidden) setReturnedFromBackground(false)
      else setReturnedFromBackground(true)
    },
    onBackupStreamReady: (stream) => {
      audioBackup.start(stream)
    },
  })
  const {
    isConnected: isDeepgramConnected,
    isCapturing: isDeepgramCapturing,
    start: startDeepgram,
    stop: stopDeepgram,
  } = deepgram

  useEffect(() => {
    const pending = readTranscriptOutbox(sessionId)
    const serverIds = new Set((session?.transcripts || []).map((item) => item.client_segment_id))
    const optimistic = pending
      .filter((item) => !serverIds.has(item.clientSegmentId))
      .map((item): NoteTranscript => ({
        id: `local-${item.sequenceNo}`,
        session_id: sessionId,
        text: item.text,
        timestamp: item.timestamp,
        speaker: item.speaker,
        client_segment_id: item.clientSegmentId,
        sequence_no: item.sequenceNo,
        created_at: item.timestamp,
      }))
    const merged = [...(session?.transcripts || []), ...optimistic].sort((a, b) => a.sequence_no - b.sequence_no)
    sequenceRef.current = Math.max(0, ...merged.map((item) => item.sequence_no + 1))
    setTranscripts(merged)
    setPendingCount(pending.length)
    void flushOutbox()
  }, [flushOutbox, session?.transcripts, sessionId])

  useEffect(() => {
    if (!session || session.status !== 'active') return
    const send = () => notesApi.heartbeatSession(sessionId).catch(() => undefined)
    send()
    const interval = window.setInterval(send, 20_000)
    return () => window.clearInterval(interval)
  }, [session, sessionId])

  useEffect(() => {
    const retry = () => void flushOutbox()
    window.addEventListener('online', retry)
    const interval = window.setInterval(retry, 5000)
    return () => {
      window.removeEventListener('online', retry)
      window.clearInterval(interval)
    }
  }, [flushOutbox])

  useEffect(() => {
    const goOffline = () => setSyncStatus('Нет подключения к интернету · текст сохраняется локально')
    const goOnline = () => void flushOutbox()
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [flushOutbox])

  useEffect(() => {
    if (!returnedFromBackground) return
    const timeout = window.setTimeout(() => setReturnedFromBackground(false), 8000)
    return () => window.clearTimeout(timeout)
  }, [returnedFromBackground])

  useEffect(() => {
    if (!sourceStoppedAlert) {
      if (titleFlashRef.current) {
        window.clearInterval(titleFlashRef.current)
        titleFlashRef.current = null
        document.title = originalTitleRef.current
      }
      return
    }
    let flashed = false
    titleFlashRef.current = window.setInterval(() => {
      document.title = flashed ? originalTitleRef.current : '⚠️ Звук остановлен — TeenTechEd'
      flashed = !flashed
    }, 1000)
    return () => {
      if (titleFlashRef.current) window.clearInterval(titleFlashRef.current)
      titleFlashRef.current = null
      document.title = originalTitleRef.current
    }
  }, [sourceStoppedAlert])

  useEffect(() => {
    if (isDeepgramConnected) setSourceStoppedAlert(false)
  }, [isDeepgramConnected])

  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!isDeepgramCapturing) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeClose)
    return () => window.removeEventListener('beforeunload', warnBeforeClose)
  }, [isDeepgramCapturing])

  const handleReconcile = useCallback(async () => {
    if (!sessionId) return
    setReconciling(true)
    try {
      const result = await notesApi.reconcileAudio(sessionId)
      setReconcileResult(result)
    } catch (err) {
      toast({
        title: 'Не удалось собрать резервный транскрипт',
        description: getErrorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setReconciling(false)
    }
  }, [sessionId])

  const requestDraft = useCallback(async () => {
    if (!sessionId) return
    setDraftLoading(true)
    try {
      const draftData = await notesApi.draftSession(sessionId)
      setDraft(draftData)
    } catch (err) {
      toast({ title: 'Не удалось собрать черновик', description: getErrorMessage(err), variant: 'destructive' })
    } finally {
      setDraftLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!isDeepgramCapturing || transcripts.length === 0) return
    const interval = window.setInterval(() => {
      if (!draftLoading && transcripts.length > 0) {
        void requestDraft()
      }
    }, 45000)
    return () => window.clearInterval(interval)
  }, [draftLoading, isDeepgramCapturing, requestDraft, transcripts.length])

  const handleStart = async (source: CaptureSource) => {
    setError('')
    setAudioLevel(0)
    setAudioStatus('')
    setCaptureSource(source)
    setSourceStoppedAlert(false)
    await stopDeepgram()
    await startDeepgram(source)
    toast({ title: 'Сессия запущена', description: source === 'system' ? 'Захват системного звука активирован' : 'Микрофон активирован' })
  }

  const handleStop = useCallback(async () => {
    if (isDeepgramCapturing) await stopDeepgram()
    audioBackup.stop()
    await savePendingInterim()
    await flushOutbox()
    setAudioLevel(0)
    setAudioStatus('')
    setCaptureSource(null)
    setSourceStoppedAlert(false)
  }, [audioBackup, flushOutbox, isDeepgramCapturing, savePendingInterim, stopDeepgram])

  const handleFinalize = useCallback(async () => {
    if (!session) return

    await handleStop()
    if (readTranscriptOutbox(sessionId).length > 0) {
      setError('Не удалось отправить все фрагменты. Проверьте сеть и повторите завершение.')
      return
    }
    setFinishing(true)
    try {
      await notesApi.endSession(sessionId)
      const result = await notesApi.finalizeSession(sessionId)
      await refetch()
      navigate(`/notes/${result.note.id}`)
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось завершить сессию'))
      setFinishing(false)
    }
  }, [handleStop, navigate, refetch, session, sessionId, transcripts.length])

  const statusLabel = isDeepgramConnected
    ? captureSource === 'system'
      ? 'Системный звук'
      : 'Микрофон'
    : isDeepgramCapturing
      ? 'Подключение…'
      : 'Ожидает запуска'

  const latestTranscript = transcripts.length ? transcripts[transcripts.length - 1].text : interimText
  const focusRecording = isDeepgramCapturing && !draft
  const captureStatusText = isDeepgramCapturing
    ? captureSource === 'system'
      ? 'Экран и системный звук захватываются'
      : 'Микрофон захватывается'
    : 'Захват не запущен'
  const recognitionStatusText = isDeepgramConnected
    ? 'Распознавание подключено'
    : isDeepgramCapturing
      ? 'Подключаем распознавание'
      : 'Распознавание не запущено'
  const saveStatusText = pendingCount > 0
    ? `${pendingCount} фрагм. ожидают отправки`
    : syncStatus
      ? syncStatus
      : 'Все фрагменты сохранены'

  if (isLoading || !session) {
    return <div className="py-12 text-center text-slate-500">Загрузка...</div>
  }

  return (
    <div className="space-y-5">
      {sourceStoppedAlert && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-[2px] border-2 border-red-600 bg-red-50 px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-700 shrink-0" />
            <p className="text-sm font-semibold text-red-800">
              Показ экрана остановлен — запись прервалась. Сохранённый текст не потерян, но новый звук не пишется.
            </p>
          </div>
          <Button size="sm" className="bg-red-700 text-white hover:bg-red-800 shrink-0" onClick={() => void handleStart('system')}>
            Возобновить показ экрана
          </Button>
        </div>
      )}
      {pendingCount > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-[2px] border border-amber-300 bg-amber-50 px-4 py-3 shadow-md">
          <p className="text-sm font-medium text-amber-900">
            Текст сохраняется локально: {pendingCount} фрагм. в очереди. Не закрывайте вкладку до отправки.
          </p>
          <Button size="sm" variant="outline" onClick={() => void flushOutbox()}>
            Отправить сейчас
          </Button>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <AudioLines className="w-4 h-4" />
            Конспекты / сессия
          </div>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-950">
            {session.title}
          </h1>
          <p className="mt-2 text-sm text-slate-500 max-w-2xl">
            {session.student_name ?? 'Без привязки к студенту'} · {formatDate(session.started_at)} · {statusLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/notes')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад
          </Button>
          <Button variant="outline" onClick={requestDraft} disabled={draftLoading || transcripts.length === 0}>
            {draftLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bot className="w-4 h-4 mr-2" />}
            AI-черновик
          </Button>
          <Button onClick={() => setFinalizeDialogOpen(true)} disabled={finishing}>
            {finishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
            Завершить
          </Button>
        </div>
      </div>

      <div className="sticky top-0 z-[9] flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
          <span className={`h-2.5 w-2.5 rounded-full ${isDeepgramCapturing ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <span className="truncate">{captureStatusText} · {recognitionStatusText}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void handleStart('mic')} disabled={isDeepgramCapturing} title="Начать запись с микрофона">
            <Mic className="w-4 h-4 mr-1.5" />
            Микрофон
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleStart('system')} disabled={isDeepgramCapturing} title="Начать запись системного звука">
            <MonitorUp className="w-4 h-4 mr-1.5" />
            Экран
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleStop()} disabled={!isDeepgramCapturing} title="Остановить запись, не завершая сессию">
            <Square className="w-4 h-4 mr-1.5" />
            Стоп
          </Button>
          <Button size="sm" onClick={() => setFinalizeDialogOpen(true)} disabled={finishing} title="Остановить запись и собрать конспект">
            <Check className="w-4 h-4 mr-1.5" />
            Завершить
          </Button>
        </div>
      </div>

      <div className={`grid gap-4 ${focusRecording ? 'xl:grid-cols-[0.9fr_1.1fr]' : 'xl:grid-cols-[0.95fr_1.15fr_0.9fr]'}`}>
        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-base text-slate-900">Запись</CardTitle>
            <CardDescription>Состояние аудио и старт сессии</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="space-y-2">
                {[
                  { label: 'Звук', value: captureStatusText, ok: isDeepgramCapturing },
                  { label: 'Распознавание', value: recognitionStatusText, ok: isDeepgramConnected },
                  { label: 'Сохранение', value: saveStatusText, ok: pendingCount === 0 && !syncStatus },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{item.label}</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">{item.value}</p>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.ok ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  </div>
                ))}
              </div>

              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-slate-950 transition-all" style={{ width: `${Math.min(100, Math.max(6, audioLevel * 220))}%` }} />
              </div>

              <p className="text-xs text-slate-500">{audioStatus || 'Выберите источник и начните запись'}</p>
              {returnedFromBackground && <p className="text-xs text-amber-700">Вкладка возвращена из фона, проверьте звук.</p>}
            </div>

            <div className="grid gap-2">
              <Button
                className="justify-start bg-black text-white hover:bg-black/90"
                onClick={() => void handleStart('mic')}
                disabled={isDeepgramCapturing}
              >
                <Mic className="w-4 h-4 mr-2" />
                Микрофон
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => void handleStart('system')}
                disabled={isDeepgramCapturing}
              >
                <MonitorUp className="w-4 h-4 mr-2" />
                Экран / системный звук
              </Button>
              <Button variant="ghost" className="justify-start" onClick={() => void handleStop()} disabled={!isDeepgramCapturing}>
                <Square className="w-4 h-4 mr-2" />
                Остановить запись
              </Button>
            </div>

            <div className="border-t border-slate-200 pt-4 text-sm text-slate-600 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span>Фрагментов</span>
                <span className="font-medium text-slate-900">{transcripts.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Ожидают отправки</span>
                <span className="font-medium text-slate-900">{pendingCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Последняя фраза</span>
                <span className="font-medium text-slate-900 truncate max-w-[12rem]">{latestTranscript || '—'}</span>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 text-sm text-slate-600 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span>Резервных фрагментов</span>
                <span className="font-medium text-slate-900">
                  {audioBackup.uploadedCount}/{audioBackup.segmentCount}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => void handleReconcile()}
                disabled={reconciling || audioBackup.uploadedCount === 0}
              >
                {reconciling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Восстановить транскрипт из резервной записи
              </Button>
              <p className="text-xs text-slate-400">
                Используйте, если live-распознавание пропало, но резервные аудио-фрагменты успели загрузиться.
              </p>
              {reconcileResult && (
                <div className="mt-2 rounded-[2px] border border-slate-200 bg-slate-50 p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-1">Резервный транскрипт</p>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">
                    {reconcileResult.backup_transcript_text || 'Пусто — распознавание не дало текста'}
                  </p>
                </div>
              )}
            </div>

            {session.student_id && (
              <Button variant="outline" asChild className="w-full justify-start">
                <Link to={`/students/${session.student_id}`}>
                  <Building2 className="w-4 h-4 mr-2" />
                  Открыть профиль студента
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-base text-slate-900">Транскрипт</CardTitle>
            <CardDescription>Фрагменты сессии и промежуточная речь</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[34rem] overflow-y-auto rounded-[2px] border border-slate-200 bg-white p-4 space-y-3">
              {transcripts.length === 0 && !interimText ? (
                <div className="flex h-full items-center justify-center text-center text-slate-400">
                  Запустите запись, чтобы увидеть фрагменты транскрипции.
                </div>
              ) : (
                <>
                  {transcripts.map((entry) => (
                    <div key={entry.client_segment_id || entry.id} className="flex gap-3 items-start">
                      <span className="w-16 shrink-0 text-xs text-slate-400 tabular-nums">
                        {new Date(entry.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="min-w-0 flex-1">
                        {entry.speaker && (
                          <span className="inline-block mb-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                            {entry.speaker}
                          </span>
                        )}
                        <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">{entry.text}</p>
                      </div>
                    </div>
                  ))}
                  {interimText && (
                    <div className="flex gap-3 items-start">
                      <span className="w-16 shrink-0 text-xs text-slate-300 tabular-nums">···</span>
                      <p className="text-sm italic leading-relaxed text-slate-500 whitespace-pre-wrap">{interimText}</p>
                    </div>
                  )}
                </>
              )}
            </div>
            {syncStatus ? <p className="mt-2 text-xs text-amber-700">{syncStatus}</p> : null}
            {pendingCount > 0 && (
              <div className="mt-2 rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Текст временно хранится на этом устройстве. Не закрывайте вкладку, пока очередь отправки не станет 0.
              </div>
            )}
            {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          </CardContent>
        </Card>

        {!focusRecording && (
        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-slate-900">AI-черновик</CardTitle>
                <CardDescription>Сравнение с текущим профилем студента</CardDescription>
              </div>
              {draftLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft ? (
              <>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Название</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{draft.title}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-2">Конспект</p>
                  <div className="max-h-64 overflow-y-auto rounded-[2px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                    {draft.summary_markdown}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-2">Предлагаемые изменения</p>
                  {draft.change_preview.length > 0
                    ? renderPairs(Object.fromEntries(draft.change_preview.map((item) => [item.field, `${entryValue(item.old_value)} → ${entryValue(item.new_value)}`])))
                    : renderPairs(draft.suggested_changes)}
                </div>
              </>
            ) : (
              <div className="flex h-[30rem] items-center justify-center text-center">
                <div className="space-y-2">
                  <Sparkles className="w-5 h-5 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-500">Черновик появится после транскрипта</p>
                  <Button variant="outline" onClick={requestDraft} disabled={transcripts.length === 0}>
                    Построить черновик
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base text-slate-900">Привязка к студенту</CardTitle>
              <CardDescription>Сессия создаётся уже с выбранным профилем</CardDescription>
            </div>
            <span className="text-xs text-slate-400">{session.student_name ?? 'Без привязки'}</span>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          {session.student_id ? (
            <Button variant="outline" asChild>
              <Link to={`/students/${session.student_id}`}>
                <Building2 className="w-4 h-4 mr-2" />
                Открыть профиль
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-slate-500">Эта сессия не привязана к студенту.</p>
          )}
          <Button variant="outline" onClick={() => void requestDraft()} disabled={!transcripts.length}>
            <Bot className="w-4 h-4 mr-2" />
            Обновить AI
          </Button>
        </CardContent>
      </Card>

      {finishing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
              <span className="font-semibold text-slate-800">Формирую и сохраняю конспект...</span>
            </div>
            <div className="flex-1 overflow-y-auto p-6 text-sm text-slate-600">
              Конспект будет прикреплён к карточке студента после создания.
            </div>
          </div>
        </div>
      )}

      <Dialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{transcripts.length ? 'Завершить сессию и собрать конспект?' : 'Завершить сессию без транскрипта?'}</DialogTitle>
            <DialogDescription>
              {transcripts.length
                ? 'Запись остановится, все сохранённые фрагменты будут отправлены в CRM, после этого AI соберёт конспект.'
                : 'В сессии пока нет фрагментов транскрипта. Конспект будет пустым или неинформативным.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[2px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Фрагментов: {transcripts.length} · ожидают отправки: {pendingCount}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeDialogOpen(false)}>
              Продолжить запись
            </Button>
            <Button
              onClick={() => {
                setFinalizeDialogOpen(false)
                void handleFinalize()
              }}
              disabled={finishing}
            >
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
