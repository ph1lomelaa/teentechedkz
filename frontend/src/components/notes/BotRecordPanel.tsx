import React, { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, CheckCircle2, Loader2 } from 'lucide-react'
import { notesApi } from '@/api/notes'
import type { ZoomStatus } from '@/api/integrations'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { LanguagePicker } from '@/components/notes/LanguagePicker'
import { ZoomConnectCard } from '@/components/notes/ZoomConnectCard'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { detectMeetingPlatform, MEETING_PLATFORM_LABELS } from '@/lib/meetingBotUi'
import type { NoteSession, NoteSessionDetail, NoteSessionLanguage } from '@/types'

function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  } catch {
    // без системных уведомлений плашка и колокольчик всё равно работают
  }
}

/**
 * «Бот в звонке»: вставить ссылку → отправить бота. Ссылка проверяется сразу:
 * бот поддерживает Zoom, Meet и Teams.
 */
export const BotRecordPanel: React.FC<{
  session: NoteSessionDetail
  inWorkspace: boolean
  zoomStatus?: ZoomStatus
  initialUrl?: string
  onSent: (session: NoteSession) => void
}> = ({ session, inWorkspace, zoomStatus, initialUrl, onSent }) => {
  const draftKey = `meeting-bot-draft:${session.id}`
  const [url, setUrl] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) ?? initialUrl ?? session.meeting_url ?? ''
    } catch {
      return initialUrl ?? session.meeting_url ?? ''
    }
  })
  // OAuth leaves this page; keep the meeting link in this tab until bot launch.
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, url) } catch { /* Storage may be unavailable. */ }
  }, [draftKey, url])
  const [language, setLanguage] = useState<NoteSessionLanguage>(session.language ?? 'ru')
  const platform = detectMeetingPlatform(url)
  const zoomBlocked = platform === 'zoom' && !zoomStatus?.connected
  const typed = url.trim().length > 6

  const sendMutation = useMutation({
    mutationFn: () => notesApi.sendBot(session.id, { meeting_url: url.trim(), language }),
    onSuccess: (sentSession) => {
      try { sessionStorage.removeItem(draftKey) } catch { /* best effort */ }
      onSent(sentSession)
    },
  })

  const sendBot = sendMutation.mutate
  useEffect(() => {
    if (!zoomStatus?.connected || platform !== 'zoom' || session.bot_status) return
    try {
      if (sessionStorage.getItem(`${draftKey}:send-after-oauth`) !== 'true') return
      sessionStorage.removeItem(`${draftKey}:send-after-oauth`)
    } catch { return }
    sendBot()
  }, [draftKey, platform, zoomStatus?.connected, session.bot_status, sendBot])

  const ink = inWorkspace ? 'text-w-ink' : 'text-p-text'
  const muted = inWorkspace ? 'text-w-muted' : 'text-p-muted'
  const panel = inWorkspace ? 'border-w-line bg-w-panel2' : 'border-p-line bg-p-bg'

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="meeting-url" className={cn('mb-2 block text-sm font-semibold', ink)}>Ссылка на встречу</label>
        <div className="relative">
          <Input
            id="meeting-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://meet.google.com/… или https://zoom.us/j/…"
            className="h-14 pr-36 text-base"
            autoComplete="off"
            inputMode="url"
            disabled={sendMutation.isPending}
          />
          {platform && (
            <span className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {MEETING_PLATFORM_LABELS[platform]}
            </span>
          )}
        </div>
        {typed && !platform && (
          <div className={cn('mt-2 flex flex-wrap items-center justify-between gap-3 rounded-panel border p-3 text-sm', inWorkspace ? 'border-w-danger/50 bg-w-danger/10 text-w-danger' : 'border-red-300 bg-red-50 text-red-800')}>
            <span>Поддерживаются ссылки Zoom, Google Meet и Microsoft Teams.</span>
          </div>
        )}
      </div>

      {zoomBlocked && <ZoomConnectCard status={zoomStatus} inWorkspace={inWorkspace} onBeforeConnect={() => {
        try {
          sessionStorage.setItem(draftKey, url)
          sessionStorage.setItem(`${draftKey}:send-after-oauth`, 'true')
        } catch { /* Link still remains in the current form. */ }
      }} />}

      <details className={cn('rounded-panel border p-3 text-sm', panel)}>
        <summary className={cn('cursor-pointer font-medium', muted)}>
          Язык: {language === 'kk' ? 'казахский' : language === 'en' ? 'английский' : 'русский'} · изменить
        </summary>
        <div className="mt-3">
          <LanguagePicker value={language} onChange={setLanguage} inWorkspace={inWorkspace} disabled={sendMutation.isPending} />
        </div>
      </details>

      {sendMutation.isError && (
        <div className={cn('rounded-panel border p-3 text-sm', inWorkspace ? 'border-w-danger/50 bg-w-danger/10 text-w-danger' : 'border-red-300 bg-red-50 text-red-800')}>
          {getErrorMessage(sendMutation.error, 'Не удалось отправить бота. Попробуйте ещё раз.')}
        </div>
      )}

      <Button
        size="lg"
        className={cn('h-14 w-full text-base', inWorkspace && 'rounded-ctl bg-w-accent font-black text-black hover:bg-w-accent/90')}
        disabled={!platform || zoomBlocked || sendMutation.isPending}
        onClick={() => {
          askNotificationPermission()
          sendMutation.mutate()
        }}
      >
        {sendMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Bot className="mr-2 h-5 w-5" />}
        {sendMutation.isPending ? 'Подключаем бота…' : 'Подключить бота'}
      </Button>
      <p className={cn('text-center text-xs', muted)}>
        Откройте встречу и впустите бота TeenTechEd. Текст появится здесь автоматически, конспект — после встречи.
      </p>
    </div>
  )
}
