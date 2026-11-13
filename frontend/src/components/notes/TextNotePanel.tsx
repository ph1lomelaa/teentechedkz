import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, PenLine } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import type { NoteSessionDetail, StudentNote } from '@/types'

/**
 * «Написать текстом»: записи нет — ментор пишет пометки сам. Можно отдать их
 * ИИ, чтобы собрал конспект по разделам, или сохранить ровно как написано.
 */
export const TextNotePanel: React.FC<{
  session: NoteSessionDetail
  inWorkspace: boolean
  onDone: (note: StudentNote) => void
}> = ({ session, inWorkspace, onDone }) => {
  const draftKey = `text-note:${session.id}`
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) || '' } catch { return '' } })
  const [useAi, setUseAi] = useState(true)
  const save = useMutation({
    mutationFn: async () => {
      await notesApi.addTranscript(session.id, { text: text.trim(), client_segment_id: `text-note-${session.id}` })
      return notesApi.finalizeSession(session.id, { use_ai: useAi })
    },
    onSuccess: (result) => {
      try { localStorage.removeItem(draftKey) } catch { /* optional draft */ }
      onDone(result.note)
    },
  })
  const ink = inWorkspace ? 'text-w-ink' : 'text-p-text'
  const muted = inWorkspace ? 'text-w-muted' : 'text-p-muted'
  const line = inWorkspace ? 'border-w-line' : 'border-p-line'
  const option = (value: boolean, title: string, hint: string) => (
    <label className={cn('flex cursor-pointer gap-3 rounded-ctl border p-3', line, useAi === value && (inWorkspace ? 'border-w-accent bg-w-accent/10' : 'border-p-accent bg-p-accent/10'))}>
      <input type="radio" name={`text-note-ai-${session.id}`} checked={useAi === value} onChange={() => setUseAi(value)} className="mt-1" />
      <span><span className={cn('block text-sm font-semibold', ink)}>{title}</span><span className={cn('block text-xs', muted)}>{hint}</span></span>
    </label>
  )

  return (
    <div className="space-y-4">
      <label className={cn('block text-sm font-semibold', ink)}>Что обсудили
        <textarea aria-label="Текст конспекта" value={text} disabled={save.isPending}
          onChange={(event) => { setText(event.target.value); save.reset(); try { localStorage.setItem(draftKey, event.target.value) } catch { /* optional draft */ } }}
          placeholder={'Можно списком:\n- обсудили Activity List, выбрали 8 активностей\n- к пятнице — черновик эссе\n- следующий созвон в среду'}
          className={cn('mt-2 min-h-56 w-full rounded-ctl border bg-transparent px-3 py-3 text-sm leading-6', line, ink)} />
      </label>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className={cn('mb-2 text-sm font-semibold', ink)}>Как сохранить</legend>
        {option(true, 'Собрать конспект с ИИ', 'ИИ разложит пометки по разделам: итоги, решения, следующие шаги.')}
        {option(false, 'Сохранить как написано', 'Текст станет конспектом без изменений.')}
      </fieldset>
      {save.isError && <p role="alert" className="text-sm text-red-500">{getErrorMessage(save.error, 'Не удалось сохранить конспект')}</p>}
      <Button className="w-full" disabled={!text.trim() || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
        {save.isPending ? (useAi ? 'Собираем конспект…' : 'Сохраняем…') : 'Сохранить конспект'}
      </Button>
      <p className={cn('text-center text-xs', muted)}>Конспект появится у этого студента. Перед публикацией студенту его можно поправить.</p>
    </div>
  )
}
