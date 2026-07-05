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
} from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDeepgramTranscription, type CaptureSource } from '@/hooks/useDeepgramTranscription'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { NoteSessionDraft, NoteTranscript } from '@/types'
import {
  createClientSegmentId,
  enqueueTranscript,
  readTranscriptOutbox,
  removeTranscriptFromOutbox,
  type PendingTranscript,
} from '@/utils/transcriptOutbox'

function entryValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
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
    },
    onVisibilityChange: (hidden) => {
      if (hidden) setReturnedFromBackground(false)
      else setReturnedFromBackground(true)
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
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!isDeepgramCapturing) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeClose)
    return () => window.removeEventListener('beforeunload', warnBeforeClose)
  }, [isDeepgramCapturing])

  const requestDraft = useCallback(async () => {
    if (!sessionId) return
    setDraftLoading(true)
    try {
      const draftData = await notesApi.draftSession(sessionId)
      setDraft(draftData)
    } catch (err) {
      toast({ title: 'Ошибка', description: (err as Error).message || 'Не удалось собрать черновик', variant: 'destructive' })
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
    await stopDeepgram()
    await startDeepgram(source)
    toast({ title: 'Сессия запущена', description: source === 'system' ? 'Захват системного звука активирован' : 'Микрофон активирован' })
  }

  const handleStop = useCallback(async () => {
    if (isDeepgramCapturing) await stopDeepgram()
    await savePendingInterim()
    await flushOutbox()
    setAudioLevel(0)
    setAudioStatus('')
    setCaptureSource(null)
  }, [flushOutbox, isDeepgramCapturing, savePendingInterim, stopDeepgram])

  const handleFinalize = useCallback(async () => {
    if (!session) return
    if (transcripts.length === 0 && !window.confirm('Завершить сессию без транскрипта?')) return
    if (transcripts.length > 0 && !window.confirm('Завершить сессию и собрать конспект?')) return

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
      setError((err as Error).message || 'Не удалось завершить сессию')
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

  if (isLoading || !session) {
    return <div className="py-12 text-center text-slate-500">Загрузка...</div>
  }

  return (
    <div className="space-y-5">
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
          <Button onClick={handleFinalize} disabled={finishing}>
            {finishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
            Завершить
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.15fr_0.9fr]">
        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-base text-slate-900">Запись</CardTitle>
            <CardDescription>Состояние аудио и старт сессии</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Статус</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{statusLabel}</p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  <span className={`w-2 h-2 rounded-full ${isDeepgramConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  {isDeepgramConnected ? 'online' : 'offline'}
                </span>
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
            {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          </CardContent>
        </Card>

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
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-2">Снимок профиля</p>
                  {renderPairs(draft.profile_snapshot)}
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
    </div>
  )
}
