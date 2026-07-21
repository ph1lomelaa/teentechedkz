import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
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
  Trash2,
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
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { NoteSessionDraft, NoteSessionReconcileResult, NoteTranscript } from '@/types'
import {
  createClientSegmentId,
  clearTranscriptOutbox,
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

function renderPairs(data: Record<string, unknown>, workspace = false) {
  const entries = Object.entries(data)
  if (!entries.length) return <p className={cn('text-sm', workspace ? 'text-w-muted2' : 'text-slate-400')}>Нет данных</p>
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className={cn('flex items-start justify-between gap-4 border-b pb-2 last:border-0 last:pb-0', workspace ? 'border-w-line' : 'border-slate-200')}>
          <span className={cn('text-sm', workspace ? 'text-w-muted' : 'text-slate-500')}>{key}</span>
          <span className={cn('max-w-[60%] whitespace-pre-wrap text-right text-sm', workspace ? 'text-w-ink' : 'text-slate-800')}>{entryValue(value)}</span>
        </div>
      ))}
    </div>
  )
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
  const [draft, setDraft] = useState<NoteSessionDraft | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

  const isReadOnly = Boolean(session.note_id)
  const pageClass = inWorkspace ? 'space-y-5 text-w-ink' : 'space-y-5'
  const headerBorderClass = inWorkspace ? 'border-w-line' : 'border-slate-200'
  const eyebrowClass = inWorkspace ? 'text-w-muted2' : 'text-slate-400'
  const titleClass = inWorkspace ? 'text-w-ink' : 'text-slate-950'
  const mutedClass = inWorkspace ? 'text-w-muted' : 'text-slate-500'
  const cardClass = inWorkspace ? 'rounded-[18px] border-w-line bg-w-panel text-w-ink shadow-none' : 'border-slate-200 bg-white'
  const cardTitleClass = inWorkspace ? 'text-base text-w-ink' : 'text-base text-slate-900'
  const cardDescriptionClass = inWorkspace ? 'text-w-muted' : undefined
  const panelClass = inWorkspace ? 'rounded-[14px] border border-w-line bg-w-panel2' : 'rounded-[2px] border border-slate-200 bg-slate-50'
  const stickyClass = inWorkspace
    ? 'sticky top-0 z-[9] flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-w-line bg-w-panel/95 px-3 py-2 shadow-sm backdrop-blur'
    : 'sticky top-0 z-[9] flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur'
  const outlineButtonClass = inWorkspace ? 'rounded-[11px] border-w-line bg-transparent text-w-muted hover:border-w-accentDim hover:bg-w-panel2 hover:text-w-accentText' : undefined
  const primaryButtonClass = inWorkspace ? 'rounded-[11px] bg-w-accent font-black text-black hover:bg-w-accent/90' : undefined
  const ghostButtonClass = inWorkspace ? 'rounded-[11px] text-w-muted hover:bg-w-panel2 hover:text-w-accentText' : undefined
  const statusDotClass = (ok: boolean) => ok ? (inWorkspace ? 'bg-w-good' : 'bg-emerald-500') : (inWorkspace ? 'bg-w-accent' : 'bg-amber-400')

  return (
    <div className={pageClass}>
      {sourceStoppedAlert && (
        <div className={cn('sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-lg', inWorkspace ? 'rounded-[14px] border border-w-danger/50 bg-w-danger/10' : 'rounded-[2px] border-2 border-red-600 bg-red-50')}>
          <div className="flex items-center gap-3">
            <AlertTriangle className={cn('h-5 w-5 shrink-0', inWorkspace ? 'text-w-danger' : 'text-red-700')} />
            <p className={cn('text-sm font-semibold', inWorkspace ? 'text-w-danger' : 'text-red-800')}>
              Показ экрана остановлен — запись прервалась. Сохранённый текст не потерян, но новый звук не пишется.
            </p>
          </div>
          <Button size="sm" className={cn('shrink-0', inWorkspace ? 'rounded-[11px] bg-w-danger text-white hover:bg-w-danger/90' : 'bg-red-700 text-white hover:bg-red-800')} onClick={() => void handleStart('system')}>
            Возобновить показ экрана
          </Button>
        </div>
      )}
      {pendingCount > 0 && (
        <div className={cn('sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-md', inWorkspace ? 'rounded-[14px] border border-w-accentDim/50 bg-w-accent/10' : 'rounded-[2px] border border-amber-300 bg-amber-50')}>
          <p className={cn('text-sm font-medium', inWorkspace ? 'text-w-accentText' : 'text-amber-900')}>
            Текст сохраняется локально: {pendingCount} фрагм. в очереди. Не закрывайте вкладку до отправки.
          </p>
          <Button size="sm" variant="outline" className={outlineButtonClass} onClick={() => void flushOutbox()}>
            Отправить сейчас
          </Button>
        </div>
      )}
      <div className={cn('flex flex-wrap items-start justify-between gap-4 border-b pb-5', headerBorderClass)}>
        <div>
          <div className={cn('flex items-center gap-2 text-[11px] uppercase tracking-[0.22em]', eyebrowClass)}>
            <AudioLines className="w-4 h-4" />
            Конспекты / сессия
          </div>
          <h1 className={cn('mt-2 font-display text-3xl font-black leading-[1.05] tracking-tight md:text-4xl', titleClass)}>
            {session.title}
          </h1>
          <p className={cn('mt-2 max-w-2xl text-sm', mutedClass)}>
            {session.student_name ?? 'Без привязки к студенту'} · {formatDate(session.started_at)} · {isReadOnly ? 'Сессия завершена, конспект готов' : statusLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className={outlineButtonClass} onClick={() => navigate(notesHome)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад
          </Button>
          {session.note_id ? (
            <Button asChild className={primaryButtonClass}>
              <Link to={notePath(session.note_id)}>
                <Bot className="w-4 h-4 mr-2" />
                Конспект
              </Link>
            </Button>
          ) : (
            <Button variant="outline" className={outlineButtonClass} onClick={requestDraft} disabled={isReadOnly || draftLoading || transcripts.length === 0}>
              {draftLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bot className="w-4 h-4 mr-2" />}
              AI-черновик
            </Button>
          )}
          {!isReadOnly && (
            <Button className={primaryButtonClass} onClick={() => setFinalizeDialogOpen(true)} disabled={finishing}>
              {finishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Завершить
            </Button>
          )}
        </div>
      </div>

      {isReadOnly ? (
        <div className={cn(stickyClass, 'justify-start')}>
          <span className={cn('h-2.5 w-2.5 rounded-full', inWorkspace ? 'bg-w-muted2' : 'bg-slate-300')} />
          <span className={cn('text-sm', inWorkspace ? 'text-w-muted' : 'text-slate-700')}>
            Конспект уже готов · только просмотр, запись недоступна
          </span>
        </div>
      ) : (
        <div className={stickyClass}>
          <div className={cn('flex min-w-0 items-center gap-2 text-sm', inWorkspace ? 'text-w-muted' : 'text-slate-700')}>
            <span className={cn('h-2.5 w-2.5 rounded-full', isDeepgramCapturing ? statusDotClass(true) : inWorkspace ? 'bg-w-muted2' : 'bg-slate-300')} />
            <span className="truncate">{captureStatusText} · {recognitionStatusText}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className={outlineButtonClass} onClick={() => void handleStart('mic')} disabled={isDeepgramCapturing} title="Начать запись с микрофона">
              <Mic className="w-4 h-4 mr-1.5" />
              Микрофон
            </Button>
            <Button size="sm" variant="outline" className={outlineButtonClass} onClick={() => void handleStart('system')} disabled={isDeepgramCapturing} title="Начать запись системного звука">
              <MonitorUp className="w-4 h-4 mr-1.5" />
              Экран
            </Button>
            <Button size="sm" variant="outline" className={outlineButtonClass} onClick={() => void handleStop()} disabled={!isDeepgramCapturing} title="Остановить запись, не завершая сессию">
              <Square className="w-4 h-4 mr-1.5" />
              Стоп
            </Button>
            <Button size="sm" className={primaryButtonClass} onClick={() => setFinalizeDialogOpen(true)} disabled={finishing} title="Остановить запись и собрать конспект">
              <Check className="w-4 h-4 mr-1.5" />
              Завершить
            </Button>
          </div>
        </div>
      )}

      <div className={`grid gap-4 ${focusRecording || isReadOnly ? 'xl:grid-cols-[0.9fr_1.1fr]' : 'xl:grid-cols-[0.95fr_1.15fr_0.9fr]'}`}>
        <Card className={cardClass}>
          <CardHeader className="pb-4">
            <CardTitle className={cardTitleClass}>Запись</CardTitle>
            <CardDescription className={cardDescriptionClass}>Состояние аудио и старт сессии</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={cn(panelClass, 'space-y-3 p-4')}>
              <div className="space-y-2">
                {[
                  { label: 'Звук', value: captureStatusText, ok: isDeepgramCapturing },
                  { label: 'Распознавание', value: recognitionStatusText, ok: isDeepgramConnected },
                  { label: 'Сохранение', value: saveStatusText, ok: pendingCount === 0 && !syncStatus },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <div>
                      <p className={cn('text-xs uppercase tracking-[0.2em]', eyebrowClass)}>{item.label}</p>
                      <p className={cn('mt-0.5 text-sm font-semibold', titleClass)}>{item.value}</p>
                    </div>
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', statusDotClass(item.ok))} />
                  </div>
                ))}
              </div>

              <div className={cn('h-2 overflow-hidden rounded-full', inWorkspace ? 'bg-w-line' : 'bg-slate-200')}>
                <div className={cn('h-full transition-all', inWorkspace ? 'bg-w-accent' : 'bg-slate-950')} style={{ width: `${Math.min(100, Math.max(6, audioLevel * 220))}%` }} />
              </div>

              <p className={cn('text-xs', mutedClass)}>{audioStatus || 'Выберите источник и начните запись'}</p>
              {returnedFromBackground && <p className={cn('text-xs', inWorkspace ? 'text-w-accentText' : 'text-amber-700')}>Вкладка возвращена из фона, проверьте звук.</p>}
            </div>

            {isReadOnly ? (
              <div className={cn(panelClass, 'p-3 text-sm', mutedClass)}>
                Конспект уже собран — запись для этой сессии больше не ведётся.
              </div>
            ) : (
              <div className="grid gap-2">
                <Button
                  className={cn('justify-start', inWorkspace ? 'rounded-[11px] bg-w-accent font-black text-black hover:bg-w-accent/90' : 'bg-black text-white hover:bg-black/90')}
                  onClick={() => void handleStart('mic')}
                  disabled={isDeepgramCapturing}
                >
                  <Mic className="w-4 h-4 mr-2" />
                  Микрофон
                </Button>
                <Button
                  variant="outline"
                  className={cn('justify-start', outlineButtonClass)}
                  onClick={() => void handleStart('system')}
                  disabled={isDeepgramCapturing}
                >
                  <MonitorUp className="w-4 h-4 mr-2" />
                  Экран / системный звук
                </Button>
                <Button variant="ghost" className={cn('justify-start', ghostButtonClass)} onClick={() => void handleStop()} disabled={!isDeepgramCapturing}>
                  <Square className="w-4 h-4 mr-2" />
                  Остановить запись
                </Button>
              </div>
            )}

            <div className={cn('space-y-1 border-t pt-4 text-sm', inWorkspace ? 'border-w-line text-w-muted' : 'border-slate-200 text-slate-600')}>
              <div className="flex items-center justify-between gap-3">
                <span>Фрагментов</span>
                <span className={cn('font-medium', titleClass)}>{transcripts.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Ожидают отправки</span>
                <span className={cn('font-medium', titleClass)}>{pendingCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Последняя фраза</span>
                <span className={cn('max-w-[12rem] truncate font-medium', titleClass)}>{latestTranscript || '—'}</span>
              </div>
            </div>

            {!isReadOnly && (
              <div className={cn('space-y-2 border-t pt-4 text-sm', inWorkspace ? 'border-w-line text-w-muted' : 'border-slate-200 text-slate-600')}>
                <div className="flex items-center justify-between gap-3">
                  <span>Резервных фрагментов</span>
                  <span className={cn('font-medium', titleClass)}>
                    {audioBackup.uploadedCount}/{audioBackup.segmentCount}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn('w-full justify-start', outlineButtonClass)}
                  onClick={() => void handleReconcile()}
                  disabled={reconciling || audioBackup.uploadedCount === 0}
                >
                  {reconciling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Восстановить транскрипт из резервной записи
                </Button>
                <p className={cn('text-xs', eyebrowClass)}>
                  Используйте, если live-распознавание пропало, но резервные аудио-фрагменты успели загрузиться.
                </p>
                {reconcileResult && (
                  <div className={cn(panelClass, 'mt-2 max-h-40 overflow-y-auto p-3')}>
                    <p className={cn('mb-1 text-xs uppercase tracking-[0.2em]', eyebrowClass)}>Резервный транскрипт</p>
                    <p className={cn('whitespace-pre-wrap text-xs', inWorkspace ? 'text-w-muted' : 'text-slate-700')}>
                      {reconcileResult.backup_transcript_text || 'Пусто — распознавание не дало текста'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {session.student_id && (
              <Button variant="outline" asChild className={cn('w-full justify-start', outlineButtonClass)}>
                <Link to={studentPath(session.student_id)}>
                  <Building2 className="w-4 h-4 mr-2" />
                  Открыть профиль студента
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className={cardClass}>
          <CardHeader className="pb-4">
            <CardTitle className={cardTitleClass}>Транскрипт</CardTitle>
            <CardDescription className={cardDescriptionClass}>Фрагменты сессии и промежуточная речь</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={cn('h-[34rem] space-y-3 overflow-y-auto p-4', inWorkspace ? 'rounded-[14px] border border-w-line bg-w-panel2' : 'rounded-[2px] border border-slate-200 bg-white')}>
              {transcripts.length === 0 && !interimText ? (
                <div className={cn('flex h-full items-center justify-center text-center', inWorkspace ? 'text-w-muted2' : 'text-slate-400')}>
                  Запустите запись, чтобы увидеть фрагменты транскрипции.
                </div>
              ) : (
                <>
                  {transcripts.map((entry) => (
                    <div key={entry.client_segment_id || entry.id} className="flex gap-3 items-start">
                      <span className={cn('w-16 shrink-0 text-xs tabular-nums', eyebrowClass)}>
                        {new Date(entry.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="min-w-0 flex-1">
                        {entry.speaker && (
                          <span className={cn('mb-1 inline-block rounded-full border px-2 py-0.5 text-[11px]', inWorkspace ? 'border-w-line bg-w-panel text-w-muted' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                            {entry.speaker}
                          </span>
                        )}
                        <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', inWorkspace ? 'text-w-ink' : 'text-slate-800')}>{entry.text}</p>
                      </div>
                    </div>
                  ))}
                  {interimText && (
                    <div className="flex gap-3 items-start">
                      <span className={cn('w-16 shrink-0 text-xs tabular-nums', inWorkspace ? 'text-w-muted2' : 'text-slate-300')}>···</span>
                      <p className={cn('whitespace-pre-wrap text-sm italic leading-relaxed', mutedClass)}>{interimText}</p>
                    </div>
                  )}
                </>
              )}
            </div>
            {syncStatus ? <p className={cn('mt-2 text-xs', inWorkspace ? 'text-w-accentText' : 'text-amber-700')}>{syncStatus}</p> : null}
            {pendingCount > 0 && (
              <div className={cn('mt-2 px-3 py-2 text-xs', inWorkspace ? 'rounded-[14px] border border-w-accentDim/50 bg-w-accent/10 text-w-accentText' : 'rounded-[2px] border border-amber-200 bg-amber-50 text-amber-800')}>
                Текст временно хранится на этом устройстве. Не закрывайте вкладку, пока очередь отправки не станет 0.
              </div>
            )}
            {error ? <p className={cn('mt-2 text-xs', inWorkspace ? 'text-w-danger' : 'text-red-600')}>{error}</p> : null}
          </CardContent>
        </Card>

        {!focusRecording && !isReadOnly && (
        <Card className={cardClass}>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className={cardTitleClass}>AI-черновик</CardTitle>
                <CardDescription className={cardDescriptionClass}>Сравнение с текущим профилем студента</CardDescription>
              </div>
              {draftLoading && <RefreshCw className={cn('h-4 w-4 animate-spin', eyebrowClass)} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft ? (
              <>
                {draft.ai_model === 'heuristic' && (
                  <div className={cn('p-2.5 text-xs', inWorkspace ? 'rounded-[14px] border border-w-accentDim/50 bg-w-accent/10 text-w-ink' : 'rounded-[2px] border border-amber-200 bg-amber-50 text-amber-900')}>
                    Черновик собран по правилам — ИИ не отработал. Проверьте, что задан рабочий OPENAI_API_KEY и бэкенд перезапущен.
                  </div>
                )}
                <div>
                  <p className={cn('text-xs uppercase tracking-[0.2em]', eyebrowClass)}>Название</p>
                  <p className={cn('mt-1 text-sm font-semibold', titleClass)}>{draft.title}</p>
                </div>
                <div>
                  <p className={cn('mb-2 text-xs uppercase tracking-[0.2em]', eyebrowClass)}>Конспект</p>
                  <div className={cn('max-h-64 overflow-y-auto p-3 text-sm whitespace-pre-wrap', panelClass, inWorkspace ? 'text-w-ink' : 'text-slate-800')}>
                    {draft.summary_markdown}
                  </div>
                </div>
                <div>
                  <p className={cn('mb-2 text-xs uppercase tracking-[0.2em]', eyebrowClass)}>Предлагаемые изменения</p>
                  {draft.change_preview.length > 0
                    ? renderPairs(Object.fromEntries(draft.change_preview.map((item) => [item.field, `${entryValue(item.old_value)} → ${entryValue(item.new_value)}`])), inWorkspace)
                    : renderPairs(
                        Object.fromEntries(
                          Object.entries(draft.suggested_changes).filter(([key]) => key !== 'profile_notes')
                        ),
                        inWorkspace,
                      )}
                </div>
                {Array.isArray((draft.suggested_changes as { profile_notes?: unknown }).profile_notes) &&
                  ((draft.suggested_changes as { profile_notes: unknown[] }).profile_notes.length > 0) && (
                  <div>
                    <p className={cn('mb-2 text-xs uppercase tracking-[0.2em]', eyebrowClass)}>В заметки профиля</p>
                    <div className="grid gap-2">
                      {((draft.suggested_changes as { profile_notes: unknown[] }).profile_notes)
                        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
                        .map((text, i) => (
                          <div key={i} className={cn('p-2.5 text-sm', inWorkspace ? 'rounded-[14px] border border-w-accentDim/50 bg-w-accent/10 text-w-ink' : 'rounded-[2px] border border-amber-200 bg-amber-50 text-slate-900')}>
                            {text}
                          </div>
                        ))}
                    </div>
                    <p className={cn('mt-1.5 text-xs', eyebrowClass)}>Сохранятся в заметки студента при подтверждении конспекта</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-[30rem] items-center justify-center text-center">
                <div className="space-y-2">
                  <Sparkles className={cn('mx-auto h-5 w-5', eyebrowClass)} />
                  <p className={cn('text-sm', mutedClass)}>Черновик появится после транскрипта</p>
                  <Button variant="outline" className={outlineButtonClass} onClick={requestDraft} disabled={transcripts.length === 0}>
                    Построить черновик
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      <Card className={cardClass}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className={cardTitleClass}>Привязка к студенту</CardTitle>
              <CardDescription className={cardDescriptionClass}>Сессия создаётся уже с выбранным профилем</CardDescription>
            </div>
            <span className={cn('text-xs', eyebrowClass)}>{session.student_name ?? 'Без привязки'}</span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          {session.student_id ? (
            <Button variant="outline" className={outlineButtonClass} asChild>
              <Link to={studentPath(session.student_id)}>
                <Building2 className="w-4 h-4 mr-2" />
                Открыть профиль
              </Link>
            </Button>
          ) : (
            <p className={cn('text-sm', mutedClass)}>Эта сессия не привязана к студенту.</p>
          )}
          {!isReadOnly && (
            <Button variant="outline" className={outlineButtonClass} onClick={() => void requestDraft()} disabled={!transcripts.length}>
              <Bot className="w-4 h-4 mr-2" />
              Обновить AI
            </Button>
          )}
        </CardContent>
      </Card>

      {finishing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className={cn('flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl', inWorkspace ? 'border border-w-line bg-w-panel text-w-ink' : 'bg-white')}>
            <div className={cn('flex items-center gap-3 border-b px-6 py-4', inWorkspace ? 'border-w-line' : 'border-slate-200')}>
              <Loader2 className={cn('h-5 w-5 animate-spin', inWorkspace ? 'text-w-accentText' : 'text-slate-600')} />
              <span className={cn('font-semibold', inWorkspace ? 'text-w-ink' : 'text-slate-800')}>Формирую и сохраняю конспект...</span>
            </div>
            <div className={cn('flex-1 overflow-y-auto p-6 text-sm', inWorkspace ? 'text-w-muted' : 'text-slate-600')}>
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
          <div className={cn('rounded-[11px] px-3 py-2 text-sm', inWorkspace ? 'border border-white/15 bg-white/[0.04] text-white/70' : cn(panelClass, mutedClass))}>
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
