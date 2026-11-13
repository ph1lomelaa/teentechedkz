import React, { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { meetingsApi } from '@/api/meetings'
import { notesApi } from '@/api/notes'
import type { WorkspaceMeeting } from '@/api/workspace'
import { toast } from '@/hooks/use-toast'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/primitives/dialog'
import { Markdown } from '@/components/shared/Markdown'

/** Что уже есть у прошедшей встречи — считает страница «Встречи» по сессии конспекта. */
export interface PastMeetingMaterials {
  hasRecording: boolean
  hasTranscript: boolean
  noteId: string | null
  processing: boolean
}

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback

/** Перечисляет то, чего нет, обычным текстом: «Нет записи и транскрипта». */
export function missingText({ hasRecording, hasTranscript, noteId, processing }: PastMeetingMaterials): string {
  if (processing) return 'Запись обрабатывается — транскрипт и конспект появятся позже.'
  const missing = [!hasRecording && 'записи', !hasTranscript && 'транскрипта', !noteId && 'конспекта'].filter(Boolean) as string[]
  if (!missing.length) return ''
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} и ${missing[missing.length - 1]}`
  return `Нет ${list}.`
}

export const PastMeetingDialog: React.FC<{
  meeting: WorkspaceMeeting
  typeLabel: string
  materials: PastMeetingMaterials
  noteBusy: boolean
  onClose: () => void
  onEdit: () => void
  onNote: () => void
  onSaved: () => void
}> = ({ meeting, typeLabel, materials, noteBusy, onClose, onEdit, onNote, onSaved }) => {
  const [outcome, setOutcome] = useState(meeting.outcome || '')
  const [message, setMessage] = useState<string | null>(null)
  const note = useQuery({
    queryKey: ['notes', 'detail', materials.noteId],
    queryFn: () => notesApi.get(materials.noteId as string),
    enabled: Boolean(materials.noteId),
  })
  const save = useMutation({
    mutationFn: () => meetingsApi.update(meeting.id, { outcome: outcome.trim(), status: 'completed' }),
    onSuccess: () => { onSaved(); toast({ title: 'Итог сохранён' }) },
    onError: () => toast({ title: 'Не удалось сохранить итог', variant: 'destructive' }),
  })
  const draft = useMutation({
    // Черновик собирается из повестки, итога и транскрипта — сначала сохраняем свежий итог.
    mutationFn: async () => {
      if (outcome.trim() !== (meeting.outcome || '').trim()) await meetingsApi.update(meeting.id, { outcome: outcome.trim(), status: 'completed' })
      return meetingsApi.createFollowUpDraft(meeting.id)
    },
    onSuccess: (result) => { setMessage(result.message); onSaved() },
    onError: (err) => toast({ title: errorText(err, 'Не удалось подготовить сообщение'), variant: 'destructive' }),
  })
  const send = useMutation({
    mutationFn: () => meetingsApi.sendFollowUp(meeting.id, (message ?? '').trim()),
    onSuccess: () => { setMessage(null); toast({ title: 'Отправлено студенту в чат' }) },
    onError: (err) => toast({ title: errorText(err, 'Не удалось отправить'), variant: 'destructive' }),
  })

  const when = new Date(meeting.starts_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  const minutes = Math.round((Date.parse(meeting.ends_at) - Date.parse(meeting.starts_at)) / 60000)
  const changed = outcome.trim() !== (meeting.outcome || '').trim()
  const missing = missingText(materials)
  const summary = note.data?.summary_markdown?.trim()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>{meeting.title}</DialogTitle>
        <DialogDescription>
          {meeting.student_name} · {when} · {minutes} мин · {typeLabel} ·{' '}
          <button type="button" className="font-bold text-w-accentText hover:underline" onClick={onEdit}>Изменить дату и тему</button>
        </DialogDescription>

        <div className="grid gap-5">
          {meeting.description && (
            <section className="text-sm">
              <h3 className="mb-1 text-xs font-bold text-w-muted">Тема / повестка</h3>
              <p className="whitespace-pre-line break-words text-w-ink">{meeting.description}</p>
            </section>
          )}

          <section className="grid gap-2">
            <label htmlFor="past-meeting-outcome" className="text-xs font-bold text-w-muted">Итог: что обсудили и решили</label>
            <textarea id="past-meeting-outcome" aria-label="Итог созвона" value={outcome} onChange={(e) => setOutcome(e.target.value)}
              placeholder="Например: обсудили Activity List, выбрали 8 активностей"
              className="min-h-24 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink" />
            {changed && (
              <div className="flex justify-end">
                <AppButton colorPrefix="w" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем...' : 'Сохранить итог'}</AppButton>
              </div>
            )}
          </section>

          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-w-muted">Конспект</h3>
              <button type="button" disabled={noteBusy} onClick={onNote} className="text-xs font-bold text-w-accentText hover:underline disabled:opacity-50">
                {materials.noteId ? 'Открыть полностью' : 'Создать конспект'}
              </button>
            </div>
            {materials.noteId ? (
              note.isLoading ? <p className="text-sm text-w-muted">Загружаем конспект…</p>
                : summary ? (
                  // Конспект бывает длинным: читаем его на «бумаге» с прокруткой, а не в узкой плашке.
                  <div className="max-h-[45vh] overflow-y-auto rounded-ctl border border-w-line bg-white px-5 py-4">
                    <Markdown className="text-[15px] leading-7">{summary}</Markdown>
                  </div>
                ) : <p className="text-sm text-w-muted">Конспект ещё пустой.</p>
            ) : null}
            {missing && <p className="text-sm text-w-muted">{missing}</p>}
          </section>

          <section className="grid gap-2 border-t border-w-line pt-4">
            <h3 className="text-xs font-bold text-w-muted">Отправить студенту</h3>
            {message === null ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-w-muted">Короткое сообщение с итогом и следующими шагами уйдёт студенту в чат кабинета.</p>
                <AppButton colorPrefix="w" size="sm" variant="subtle" disabled={draft.isPending || (!outcome.trim() && !meeting.description && !materials.hasTranscript)}
                  title={!outcome.trim() && !meeting.description && !materials.hasTranscript ? 'Сначала запишите итог' : undefined}
                  onClick={() => draft.mutate()}>{draft.isPending ? 'Готовим...' : 'Подготовить сообщение'}</AppButton>
              </div>
            ) : (
              <>
                <textarea aria-label="Сообщение студенту" value={message} onChange={(e) => setMessage(e.target.value)}
                  className="min-h-32 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink" />
                <div className="flex justify-end gap-2">
                  <AppButton colorPrefix="w" size="sm" variant="subtle" onClick={() => setMessage(null)}>Отмена</AppButton>
                  <AppButton colorPrefix="w" size="sm" disabled={send.isPending || !message.trim()} onClick={() => send.mutate()}>{send.isPending ? 'Отправляем...' : 'Отправить в чат'}</AppButton>
                </div>
              </>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
