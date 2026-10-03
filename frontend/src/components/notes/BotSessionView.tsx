import React, { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, Bot, CheckCircle2, DoorOpen, Loader2, RefreshCw, Square, Trash2 } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatRecordingDuration } from '@/lib/noteSessionUi'
import {
  botStatusView,
  detectMeetingPlatform,
  isBotActive,
  MEETING_PLATFORM_LABELS,
  type BotTone,
} from '@/lib/meetingBotUi'
import type { NoteSessionDetail } from '@/types'

const TONE_CLASSES: Record<BotTone, { workspace: string; crm: string }> = {
  pending: { workspace: 'border-w-line bg-w-panel2 text-w-ink', crm: 'border-p-line bg-p-bg text-p-text' },
  attention: {
    workspace: 'border-amber-400 bg-amber-400/15 text-amber-600 dark:text-amber-300',
    crm: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  recording: { workspace: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', crm: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  processing: { workspace: 'border-w-line bg-w-panel2 text-w-ink', crm: 'border-p-line bg-p-bg text-p-text' },
  good: { workspace: 'border-w-good/40 bg-w-good/10 text-w-good', crm: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  danger: { workspace: 'border-w-danger/50 bg-w-danger/10 text-w-danger', crm: 'border-red-300 bg-red-50 text-red-800' },
}

function ToneIcon({ tone }: { tone: BotTone }) {
  if (tone === 'recording') {
    return (
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-40" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
      </span>
    )
  }
  if (tone === 'attention') return <DoorOpen className="h-6 w-6 shrink-0 animate-pulse" />
  if (tone === 'danger') return <AlertCircle className="h-6 w-6 shrink-0" />
  if (tone === 'good') return <CheckCircle2 className="h-6 w-6 shrink-0" />
  return <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
}

/** Экран записи ботом: шаги, большой статус, таймер, живой текст, действия. */
export const BotSessionView: React.FC<{
  session: NoteSessionDetail
  inWorkspace: boolean
  onChanged: () => void
  onDelete: () => void
  deleting?: boolean
}> = ({ session, inWorkspace, onChanged, onDelete, deleting }) => {
  const [confirmStop, setConfirmStop] = useState(false)
  const [now, setNow] = useState(Date.now())
  const status = session.bot_status
  const platform = session.meeting_url ? detectMeetingPlatform(session.meeting_url) : null
  const view = botStatusView({ status, platform, reasonMessage: session.bot_status_message })
  const failed = status === 'failed'
  const recording = status === 'recording' || status === 'paused'

  // Экран сменился с «Отправить бота» на статус — показываем его с начала,
  // иначе шаги и статус остаются выше прокрутки.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  const stopMutation = useMutation({
    mutationFn: () => notesApi.stopBot(session.id),
    onSuccess: () => {
      setConfirmStop(false)
      onChanged()
    },
    onError: (err) => toast({ title: 'Не удалось остановить бота', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const retryMutation = useMutation({
    mutationFn: () => notesApi.sendBot(session.id, { meeting_url: session.meeting_url ?? '', language: session.language }),
    onSuccess: onChanged,
    onError: (err) => toast({ title: 'Не удалось отправить бота', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const ink = inWorkspace ? 'text-w-ink' : 'text-p-text'
  const muted = inWorkspace ? 'text-w-muted' : 'text-p-muted'
  const muted2 = inWorkspace ? 'text-w-muted2' : 'text-p-muted2'
  const card = inWorkspace ? 'rounded-card border border-w-line bg-w-panel' : 'rounded-card border border-p-line bg-white'
  const elapsed = session.bot_joined_at ? formatRecordingDuration((now - new Date(session.bot_joined_at).getTime()) / 1000) : null
  const transcripts = session.transcripts.slice(-60)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div data-tone={view.tone} className={cn('note-bot-status rounded-card border p-5', inWorkspace ? TONE_CLASSES[view.tone].workspace : TONE_CLASSES[view.tone].crm)}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <ToneIcon tone={view.tone} />
            <div className="min-w-0">
              <p className="text-lg font-black leading-tight">{view.title}</p>
              <p className="mt-1 max-w-2xl text-sm opacity-85">{view.description}</p>
              {session.meeting_url && (
                <a href={session.meeting_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold underline underline-offset-4 opacity-80">
                  {platform ? MEETING_PLATFORM_LABELS[platform] : 'Встреча'} · открыть встречу
                </a>
              )}
            </div>
          </div>
          {elapsed && recording && (
            <div className="shrink-0 font-mono text-3xl font-bold tabular-nums">{elapsed}</div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {isBotActive(status) && status !== 'processing' && (
            <Button variant="outline" onClick={() => setConfirmStop(true)} disabled={stopMutation.isPending}>
              <Square className="mr-2 h-4 w-4" />
              Остановить запись
            </Button>
          )}
          {failed && (
            <>
              <Button onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending || !session.meeting_url}>
                {retryMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Отправить ещё раз
              </Button>
              {!session.transcripts.length && (
                <Button variant="outline" onClick={onDelete} disabled={deleting}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deleting ? 'Удаляем…' : 'Удалить сессию'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={cn('p-5', card)}>
        <div className="flex items-center gap-2">
          <Bot className={cn('h-4 w-4', muted2)} />
          <p className={cn('font-semibold', ink)}>Текст встречи</p>
        </div>
        <p className={cn('mt-0.5 text-xs', muted)}>Появляется по ходу разговора. Окончательный текст и конспект — после встречи.</p>
        <div className={cn('mt-3 max-h-[24rem] space-y-3 overflow-y-auto rounded-panel border p-4', inWorkspace ? 'border-w-line bg-w-panel2' : 'border-p-line bg-p-bg')}>
          {transcripts.length === 0 ? (
            <p className={cn('py-8 text-center text-sm', muted2)}>
              {recording ? 'Бот слушает — первые фразы появятся здесь.' : 'Текст появится, когда бот начнёт запись.'}
            </p>
          ) : transcripts.map((entry) => (
            <div key={entry.client_segment_id || entry.id} className="flex items-start gap-3">
              <span className={cn('w-14 shrink-0 text-xs tabular-nums', muted2)}>
                {new Date(entry.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className="min-w-0 flex-1">
                {entry.speaker && <span className={cn('text-xs font-bold', muted)}>{entry.speaker}</span>}
                <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', ink)}>{entry.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Остановить запись?</DialogTitle>
            <DialogDescription>
              Бот выйдет из звонка. Текст, записанный до этого момента, соберётся в черновик конспекта.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => setConfirmStop(false)}>Продолжить запись</Button>
            <Button onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
              {stopMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Остановить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
