import React from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import type { NoteRecordingInfo } from '@/types'

/**
 * Пометка на черновике конспекта: «Запись неполная» с причинами и мягкие
 * подсказки (неуверенное распознавание, студента почти не слышно). Конспект
 * при этом не применяется сам — ментор решает, что с ним делать.
 */
export const RecordingQualityBanner: React.FC<{ recording?: NoteRecordingInfo | null }> = ({ recording }) => {
  const retranscribeMutation = useMutation({
    mutationFn: () => notesApi.retranscribe(recording!.session_id),
    onSuccess: () => toast({
      title: 'Распознаём заново',
      description: 'Это займёт пару минут. Пришлём уведомление, когда текст будет готов.',
    }),
    onError: (err) => toast({ title: 'Не удалось запустить', description: getErrorMessage(err), variant: 'destructive' }),
  })

  if (!recording) return null
  const incomplete = recording.quality === 'incomplete'
  const warnings = recording.quality_warning_messages
  if (!incomplete && warnings.length === 0) return null

  return (
    <div className="note-quality rounded-2xl border p-5" data-incomplete={incomplete}>
      <div className="flex items-start gap-3">
        {incomplete ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> : <Info className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{incomplete ? 'Запись неполная — проверьте конспект внимательно' : 'Обратите внимание'}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {recording.quality_reason_messages.map((message) => <li key={message}>{message}</li>)}
            {warnings.map((message) => <li key={message}>{message}</li>)}
          </ul>
          <p className="mt-2 text-sm opacity-80">
            {recording.has_audio
              ? 'Можно распознать звук встречи заново — например, если был выбран не тот язык. Или допишите конспект вручную перед одобрением.'
              : 'Допишите недостающее вручную перед одобрением или отклоните черновик.'}
          </p>
          {recording.has_audio && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => retranscribeMutation.mutate()}
              disabled={retranscribeMutation.isPending || retranscribeMutation.isSuccess}
            >
              {retranscribeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {retranscribeMutation.isSuccess ? 'Распознаём…' : 'Распознать заново'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
