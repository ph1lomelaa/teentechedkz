import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  AudioLines,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  AlertCircle,
  Clock3,
  Loader2,
  MonitorUp,
  RefreshCw,
  AlertTriangle,
  Trash2,
} from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { useDeepgramTranscription, type CaptureSource } from '@/hooks/useDeepgramTranscription'
import { useAudioBackupRecorder } from '@/hooks/useAudioBackupRecorder'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { NoteSessionReconcileResult, NoteTranscript } from '@/types'
import {
  createClientSegmentId,
  clearTranscriptOutbox,
  enqueueTranscript,
  readTranscriptOutbox,
  removeTranscriptFromOutbox,
  type PendingTranscript,
} from '@/utils/transcriptOutbox'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  formatRecordingDuration,
  getRecordingHealth,
  humanizeRecordingError,
} from '@/lib/noteSessionUi'

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

export const NoteSessionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const inWorkspace = location.pathname.startsWith('/workspace/')
  const notesHome = inWorkspace ? '/workspace/meetings?tab=notes' : '/notes'
  const notePath = useCallback(
    (noteId: string) => inWorkspace ? `/workspace/meetings/notes/${noteId}` : `/notes/${noteId}`,
    [inWorkspace],
  )
  const studentPath = (studentId: string) => inWorkspace ? `/workspace/students/${studentId}#meetings` : `/students/${studentId}`
  const sessionId = id ?? ''

  const [transcripts, setTranscripts] = useState<NoteTranscript[]>([])
  const [interimText, setInterimText] = useState('')
  const [interimSpeaker, setInterimSpeaker] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [audioStatus, setAudioStatus] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [returnedFromBackground, setReturnedFromBackground] = useState(false)
  const [captureSource, setCaptureSource] = useState<CaptureSource | null>(null)
  const [sourceStoppedAlert, setSourceStoppedAlert] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<NoteSessionReconcileResult | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false)
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null)
  const [clockNow, setClockNow] = useState(Date.now())

  const audioBackup = useAudioBackupRecorder(sessionId)
  const originalTitleRef = useRef(document.title)
  const titleFlashRef = useRef<number | null>(null)

  const transcriptsRef = useRef<NoteTranscript[]>([])
  const interimRef = useRef('')
  const interimSpeakerRef = useRef<string | null>(null)
  const savingInterimRef = useRef(false)
  const sequenceRef = useRef(0)
  const flushPromiseRef = useRef<Promise<void> | null>(null)
  const lastAudibleAtRef = useRef(Date.now())

  const { data: session, isLoading, refetch } = useQuery({
    queryKey: ['note-session', sessionId],
    queryFn: () => notesApi.getSession(sessionId),
    enabled: Boolean(sessionId),
  })

  // A finished session with a конспект already generated has nothing left to
  // show here — every entry point (meeting/student-card buttons, bookmarks)
  // should land on the конспект itself, not this recording/transcript view.
  useEffect(() => {
    if (session?.note_id) {
      navigate(notePath(session.note_id), { replace: true })
    }
  }, [session?.note_id, notePath, navigate])

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
  const handleAudioLevel = useCallback((level: number) => {
    setAudioLevel(level)
    if (level > 0.008) lastAudibleAtRef.current = Date.now()
  }, [])

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
    onAudioLevel: handleAudioLevel,
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
    const originalTitle = originalTitleRef.current
    if (!sourceStoppedAlert) {
      if (titleFlashRef.current) {
        window.clearInterval(titleFlashRef.current)
        titleFlashRef.current = null
        document.title = originalTitle
      }
      return
    }
    let flashed = false
    titleFlashRef.current = window.setInterval(() => {
      document.title = flashed ? originalTitle : '⚠️ Звук остановлен — TeenTechEd'
      flashed = !flashed
    }, 1000)
    return () => {
      if (titleFlashRef.current) window.clearInterval(titleFlashRef.current)
      titleFlashRef.current = null
      document.title = originalTitle
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

  useEffect(() => {
    if (!isDeepgramCapturing) return
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isDeepgramCapturing])

  const handleReconcile = useCallback(async () => {
    if (!sessionId) return
    setReconciling(true)
    try {
      const result = await notesApi.reconcileAudio(sessionId)
      setReconcileResult(result)
      if (result.queued) {
        // Транскрипция теперь идёт в фоновом воркере, а не в этом запросе —
        // ждём, пока все чанки перестанут быть pending/processing, вместо
        // немедленного ответа.
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
        for (let attempt = 0; attempt < 40; attempt++) {
          await sleep(3000)
          const chunks = await notesApi.listAudioChunks(sessionId)
          const stillWorking = chunks.some((c) => c.status === 'pending' || c.status === 'processing')
          if (!stillWorking) {
            const fresh = await refetch()
            setReconcileResult({
              backup_transcript_text: fresh.data?.backup_transcript_text ?? '',
              chunks,
              queued: false,
            })
            break
          }
        }
      }
    } catch (err) {
      toast({
        title: 'Не удалось собрать резервный транскрипт',
        description: getErrorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setReconciling(false)
    }
  }, [sessionId, refetch])

  const handleStart = async (source: CaptureSource) => {
    setError('')
    setAudioLevel(0)
    setAudioStatus('')
    setCaptureSource(source)
    setSourceStoppedAlert(false)
    lastAudibleAtRef.current = Date.now()
    setRecordingStartedAt((current) => current ?? Date.now())
    setClockNow(Date.now())
    await stopDeepgram()
    await startDeepgram(source)
  }

  const handleStop = useCallback(async () => {
    if (isDeepgramCapturing) await stopDeepgram()
    audioBackup.stop()
    await savePendingInterim()
    await flushOutbox()
    setAudioLevel(0)
    setAudioStatus('')
    setCaptureSource(null)
    setRecordingStartedAt(null)
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
      navigate(notePath(result.note.id))
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось завершить сессию'))
      setFinishing(false)
    }
  }, [handleStop, navigate, notePath, refetch, session, sessionId])

  const handleDeleteSession = useCallback(async () => {
    if (!sessionId) return
    setDeleting(true)
    try {
      if (isDeepgramCapturing) await stopDeepgram()
      audioBackup.stop()
      clearTranscriptOutbox(sessionId)
      await notesApi.deleteSession(sessionId)
      setFinalizeDialogOpen(false)
      toast({ title: 'Сессия удалена', description: 'Случайный конспект не будет сохранён.' })
      navigate(notesHome)
    } catch (err) {
      toast({ title: 'Не удалось удалить сессию', description: getErrorMessage(err), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }, [audioBackup, isDeepgramCapturing, navigate, notesHome, sessionId, stopDeepgram])

  const captureStatusText = isDeepgramCapturing
    ? captureSource === 'system'
      ? 'Звук встречи и микрофон подключены'
      : 'Микрофон подключён'
    : 'Источник звука не активен'
  const recognitionStatusText = isDeepgramConnected
    ? 'Текст распознаётся'
    : isDeepgramCapturing
      ? 'Подключаем распознавание…'
      : 'Распознавание ожидает запуска'
  const saveStatusText = pendingCount > 0
    ? `${pendingCount} фрагм. сохранены на устройстве`
    : syncStatus
      ? syncStatus
      : 'Всё сохранено'

  if (isLoading || !session) {
    return <div className="py-12 text-center text-p-muted">Загрузка...</div>
  }

  const isReadOnly = Boolean(session.note_id)
  const pageClass = inWorkspace ? 'space-y-5 text-w-ink' : 'space-y-5'
  const headerBorderClass = inWorkspace ? 'border-w-line' : 'border-p-line'
  const eyebrowClass = inWorkspace ? 'text-w-muted2' : 'text-p-muted2'
  const titleClass = inWorkspace ? 'text-w-ink' : 'text-p-text'
  const mutedClass = inWorkspace ? 'text-w-muted' : 'text-p-muted'
  const cardClass = inWorkspace ? 'rounded-card border-w-line bg-w-panel text-w-ink shadow-none' : 'border-p-line bg-white'
  const cardTitleClass = inWorkspace ? 'text-base text-w-ink' : 'text-base text-p-text'
  const cardDescriptionClass = inWorkspace ? 'text-w-muted' : undefined
  const panelClass = inWorkspace ? 'rounded-panel border border-w-line bg-w-panel2' : 'rounded-panel border border-p-line bg-p-bg'
  const outlineButtonClass = inWorkspace ? 'rounded-ctl border-w-line bg-transparent text-w-muted hover:border-w-accentDim hover:bg-w-panel2 hover:text-w-accentText' : undefined
  const primaryButtonClass = inWorkspace ? 'rounded-ctl bg-w-accent font-black text-black hover:bg-w-accent/90' : undefined
  const hasRecording = isDeepgramCapturing || transcripts.length > 0 || Boolean(interimText) || sourceStoppedAlert
  const elapsedSeconds = recordingStartedAt ? Math.max(0, Math.floor((clockNow - recordingStartedAt) / 1000)) : 0
  const elapsedLabel = formatRecordingDuration(elapsedSeconds)
  const noRecentSound = isDeepgramCapturing
    && isDeepgramConnected
    && elapsedSeconds >= 12
    && clockNow - lastAudibleAtRef.current > 12_000

  const readableError = humanizeRecordingError(error)
  const health = getRecordingHealth({
    sourceStopped: sourceStoppedAlert,
    error: readableError,
    pendingCount,
    syncStatus,
    isCapturing: isDeepgramCapturing,
    isConnected: isDeepgramConnected,
    noRecentSound,
  })

  const healthClass = health.tone === 'good'
    ? inWorkspace ? 'border-w-good/40 bg-w-good/10 text-w-good' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : health.tone === 'danger'
      ? inWorkspace ? 'border-w-danger/50 bg-w-danger/10 text-w-danger' : 'border-red-300 bg-red-50 text-red-800'
      : health.tone === 'warning'
        ? inWorkspace ? 'border-w-accentDim/60 bg-w-accent/10 text-w-accentText' : 'border-amber-300 bg-amber-50 text-amber-900'
        : inWorkspace ? 'border-w-line bg-w-panel2 text-w-muted' : 'border-p-line bg-p-bg text-p-muted'

  return (
    <div className={pageClass}>
      <div className={cn('flex flex-wrap items-start justify-between gap-4 border-b pb-5', headerBorderClass)}>
        <div>
          <div className={cn('flex items-center gap-2 text-[11px] uppercase tracking-[0.22em]', eyebrowClass)}>
            <AudioLines className="w-4 h-4" />
            Создание конспекта
          </div>
          <h1 className={cn('mt-2 font-display text-3xl font-black leading-[1.05] tracking-tight md:text-4xl', titleClass)}>
            {session.title}
          </h1>
          <p className={cn('mt-2 max-w-2xl text-sm', mutedClass)}>
            {session.student_name ?? 'Без привязки к студенту'} · {formatDate(session.started_at)}
          </p>
        </div>
        <Button variant="outline" className={outlineButtonClass} onClick={() => navigate(notesHome)}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Назад
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { number: 1, label: 'Подготовка', active: !hasRecording, done: hasRecording },
          { number: 2, label: 'Запись', active: hasRecording, done: isReadOnly },
          { number: 3, label: 'Проверка', active: isReadOnly, done: false },
        ].map((step) => (
          <div
            key={step.number}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-panel border px-3 py-2.5 text-sm transition-colors',
              step.active
                ? 'border-[#FFD400]/70 bg-[#FFD400]/10 text-[#FFD400]'
                : step.done
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500'
                  : inWorkspace ? 'border-w-line text-w-muted2' : 'border-p-line text-p-muted2',
            )}
          >
            <span className={cn(
              'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
              step.active
                ? 'bg-[#FFD400] text-black'
                : step.done
                  ? 'bg-emerald-500 text-white'
                  : inWorkspace ? 'bg-w-panel2 text-w-muted2' : 'bg-p-bg text-p-muted2',
            )}>
              {step.done ? <Check className="h-3.5 w-3.5" /> : step.number}
            </span>
            <span className="truncate font-medium">{step.label}</span>
          </div>
        ))}
      </div>

      {!hasRecording ? (
        <Card className={cn(cardClass, 'w-full')}>
          <CardHeader>
            <CardTitle className={cn(cardTitleClass, 'text-xl')}>Подготовка к встрече</CardTitle>
            <CardDescription className={cardDescriptionClass}>
              Проверьте ученика и запустите запись разговора.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className={cn(panelClass, 'flex flex-wrap items-center justify-between gap-3 p-4')}>
              <div>
                <p className={cn('text-xs uppercase tracking-[0.2em]', eyebrowClass)}>Ученик</p>
                <p className={cn('mt-1 font-semibold', titleClass)}>{session.student_name ?? 'Ученик не выбран'}</p>
              </div>
              {session.student_id && (
                <Button variant="outline" size="sm" className={outlineButtonClass} asChild>
                  <Link to={studentPath(session.student_id)}>
                    <Building2 className="mr-2 h-4 w-4" />
                    Открыть профиль
                  </Link>
                </Button>
              )}
            </div>

            <div>
              <p className={cn('mb-2 text-sm font-semibold', titleClass)}>Источник звука</p>
              <div className={cn(
                'flex items-start gap-4 rounded-panel border p-4',
                inWorkspace ? 'border-w-accentDim bg-w-accent/10' : 'border-p-line bg-p-bg',
              )}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFD400] text-black">
                  <MonitorUp className="h-5 w-5" />
                </span>
                <div>
                  <p className={cn('font-semibold', titleClass)}>Звук встречи</p>
                  <p className={cn('mt-1 text-sm leading-relaxed', mutedClass)}>
                    Запишем исходный звук Zoom или Google Meet без изменения его громкости. После нажатия выберите вкладку или окно встречи и разрешите передачу аудио.
                  </p>
                </div>
              </div>
            </div>

            {readableError && (
              <div className={cn('flex items-start gap-3 rounded-panel border p-3 text-sm', healthClass)}>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{readableError}</span>
              </div>
            )}

            <Button
              size="lg"
              className={cn('w-full', primaryButtonClass)}
              onClick={() => void handleStart('system')}
            >
              <MonitorUp className="mr-2 h-5 w-5" />
              Записать встречу
            </Button>
            <p className={cn('text-center text-xs', eyebrowClass)}>
              Браузер попросит выбрать окно встречи и разрешить звук. Конспект появится после завершения.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mx-auto w-full max-w-5xl space-y-4">
          <Card className={cardClass}>
            <CardContent className="p-5">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                  <span className={cn(
                    'grid h-14 w-14 shrink-0 place-items-center rounded-full',
                    isDeepgramCapturing
                      ? inWorkspace ? 'bg-w-danger/15 text-w-danger' : 'bg-red-100 text-red-600'
                      : inWorkspace ? 'bg-w-panel2 text-w-muted' : 'bg-p-bg text-p-muted',
                  )}>
                    <span className={cn('h-4 w-4 rounded-full', isDeepgramCapturing ? 'animate-pulse bg-current' : 'bg-current')} />
                  </span>
                  <div>
                    <p className={cn('text-sm font-semibold', titleClass)}>
                      {isDeepgramCapturing ? 'Запись идёт' : 'Запись приостановлена'}
                    </p>
                    <div className={cn('mt-1 flex items-center gap-2 font-mono text-3xl font-bold tabular-nums', titleClass)}>
                      <Clock3 className={cn('h-5 w-5', eyebrowClass)} />
                      {elapsedLabel}
                    </div>
                  </div>
                </div>
                <Button
                  size="lg"
                  className={cn('min-w-56', primaryButtonClass)}
                  onClick={() => setFinalizeDialogOpen(true)}
                  disabled={finishing}
                >
                  <Check className="mr-2 h-5 w-5" />
                  Завершить встречу
                </Button>
              </div>

              <div className={cn('mt-5 flex flex-wrap items-center justify-between gap-3 rounded-panel border p-3', healthClass)}>
                <div className="flex min-w-0 items-start gap-3">
                  {health.tone === 'good'
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                    : health.tone === 'danger'
                      ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                      : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                  <div>
                    <p className="text-sm font-semibold">{health.title}</p>
                    <p className="mt-0.5 text-xs opacity-80">{health.description}</p>
                  </div>
                </div>
                {sourceStoppedAlert && (
                  <Button size="sm" onClick={() => void handleStart(captureSource ?? 'system')}>
                    Возобновить
                  </Button>
                )}
                {pendingCount > 0 && !sourceStoppedAlert && (
                  <Button size="sm" variant="outline" className={outlineButtonClass} onClick={() => void flushOutbox()}>
                    Отправить сейчас
                  </Button>
                )}
              </div>

              <div className={cn('mt-4 h-2 overflow-hidden rounded-full', inWorkspace ? 'bg-w-line' : 'bg-p-line')}>
                <div
                  className={cn('h-full rounded-full transition-all duration-150', inWorkspace ? 'bg-w-accent' : 'bg-p-text')}
                  style={{ width: `${isDeepgramCapturing ? Math.min(100, Math.max(3, audioLevel * 300)) : 0}%` }}
                />
              </div>
              <p className={cn('mt-1.5 text-xs', eyebrowClass)}>
                {isDeepgramCapturing ? 'Полоса двигается, когда система слышит звук.' : 'Возобновите запись, чтобы продолжить.'}
              </p>
            </CardContent>
          </Card>

          <Card className={cardClass}>
            <CardHeader className="pb-3">
              <CardTitle className={cardTitleClass}>Текущий транскрипт</CardTitle>
              <CardDescription className={cardDescriptionClass}>Текст появляется автоматически во время разговора</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={cn('h-[28rem] space-y-3 overflow-y-auto p-4', panelClass)}>
                {transcripts.length === 0 && !interimText ? (
                  <div className={cn('flex h-full items-center justify-center text-center text-sm', eyebrowClass)}>
                    Говорите как обычно — первые фразы появятся здесь.
                  </div>
                ) : (
                  <>
                    {transcripts.map((entry) => (
                      <div key={entry.client_segment_id || entry.id} className="flex items-start gap-3">
                        <span className={cn('w-14 shrink-0 text-xs tabular-nums', eyebrowClass)}>
                          {new Date(entry.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <div className="min-w-0 flex-1">
                          {entry.speaker && (
                            <span className={cn('mb-1 inline-block rounded-full border px-2 py-0.5 text-[11px]', inWorkspace ? 'border-w-line bg-w-panel text-w-muted' : 'border-p-line bg-white text-p-muted')}>
                              {entry.speaker}
                            </span>
                          )}
                          <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', titleClass)}>{entry.text}</p>
                        </div>
                      </div>
                    ))}
                    {interimText && (
                      <div className="flex items-start gap-3">
                        <span className={cn('w-14 shrink-0 text-xs', eyebrowClass)}>···</span>
                        <p className={cn('whitespace-pre-wrap text-sm italic leading-relaxed', mutedClass)}>{interimText}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <details className={cn('group rounded-panel border', inWorkspace ? 'border-w-line bg-w-panel' : 'border-p-line bg-white')}>
            <summary className={cn('flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium', titleClass)}>
              Диагностика и восстановление
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className={cn('grid gap-4 border-t p-4 text-sm md:grid-cols-3', inWorkspace ? 'border-w-line' : 'border-p-line')}>
              {[
                ['Звук', captureStatusText],
                ['Распознавание', recognitionStatusText],
                ['Сохранение', saveStatusText],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className={cn('text-xs uppercase tracking-[0.18em]', eyebrowClass)}>{label}</p>
                  <p className={cn('mt-1', titleClass)}>{value}</p>
                </div>
              ))}
              <div className="md:col-span-3">
                <p className={cn('mb-2 text-xs', eyebrowClass)}>
                  Резервная запись: {audioBackup.uploadedCount}/{audioBackup.segmentCount} фрагментов
                  {audioStatus ? ` · ${audioStatus}` : ''}
                  {returnedFromBackground ? ' · Вкладка возвращена из фона, проверьте звук' : ''}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className={outlineButtonClass}
                  onClick={() => void handleReconcile()}
                  disabled={reconciling || audioBackup.uploadedCount === 0}
                >
                  {reconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Восстановить текст из резервной записи
                </Button>
                {reconcileResult && (
                  <p className={cn('mt-2 whitespace-pre-wrap text-xs', mutedClass)}>
                    {reconcileResult.queued ? 'Восстанавливаем текст в фоне…' : reconcileResult.backup_transcript_text || 'Дополнительный текст не найден.'}
                  </p>
                )}
              </div>
            </div>
          </details>
        </div>
      )}

      {finishing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className={cn('flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl', inWorkspace ? 'border border-w-line bg-w-panel text-w-ink' : 'bg-white')}>
            <div className={cn('flex items-center gap-3 border-b px-6 py-4', inWorkspace ? 'border-w-line' : 'border-p-line')}>
              <Loader2 className={cn('h-5 w-5 animate-spin', inWorkspace ? 'text-w-accentText' : 'text-p-muted')} />
              <span className={cn('font-semibold', inWorkspace ? 'text-w-ink' : 'text-p-text')}>Формирую и сохраняю конспект...</span>
            </div>
            <div className={cn('flex-1 overflow-y-auto p-6 text-sm', inWorkspace ? 'text-w-muted' : 'text-p-muted')}>
              Конспект будет прикреплён к карточке студента после создания.
            </div>
          </div>
        </div>
      )}

      <Dialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <DialogContent className={cn('max-w-md', inWorkspace ? 'border-[#3A3A36] bg-[#181816] text-white shadow-[0_24px_80px_rgba(0,0,0,0.65)]' : undefined)}>
          <DialogHeader>
            <DialogTitle className={inWorkspace ? 'pr-8 text-white' : undefined}>{transcripts.length ? 'Завершить сессию и собрать конспект?' : 'Завершить сессию без транскрипта?'}</DialogTitle>
            <DialogDescription className={inWorkspace ? 'text-white/65' : cardDescriptionClass}>
              {transcripts.length
                ? 'Запись остановится, все сохранённые фрагменты останутся в общей базе студента, после этого AI соберёт конспект.'
                : 'В сессии пока нет фрагментов транскрипта. Конспект будет пустым или неинформативным.'}
            </DialogDescription>
          </DialogHeader>
          <div className={cn('rounded-ctl px-3 py-2 text-sm', inWorkspace ? 'border border-white/15 bg-white/[0.04] text-white/70' : cn(panelClass, mutedClass))}>
            Фрагментов: {transcripts.length} · ожидают отправки: {pendingCount}
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              variant="outline"
              className={inWorkspace ? 'border-red-400/50 bg-transparent text-red-300 hover:border-red-400 hover:bg-red-500/10 hover:text-red-200' : undefined}
              onClick={() => void handleDeleteSession()}
              disabled={finishing || deleting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? 'Удаляем…' : 'Удалить сессию'}
            </Button>
            <Button variant="outline" className={inWorkspace ? 'border-white/25 bg-transparent text-white hover:border-white/50 hover:bg-white/10' : outlineButtonClass} onClick={() => setFinalizeDialogOpen(false)} disabled={deleting}>
              Отмена
            </Button>
            <Button
              className={inWorkspace ? 'bg-[#FFD400] font-black text-black hover:bg-[#E7BF00]' : primaryButtonClass}
              onClick={() => {
                setFinalizeDialogOpen(false)
                void handleFinalize()
              }}
              disabled={finishing || deleting}
            >
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
