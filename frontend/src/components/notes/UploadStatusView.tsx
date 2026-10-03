import React from 'react'
import { AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { cn } from '@/lib/utils'
import type { NoteSessionDetail } from '@/types'

/** После загрузки файла: «Распознаём запись…» или понятная причина сбоя. */
export const UploadStatusView: React.FC<{
  session: NoteSessionDetail
  inWorkspace: boolean
  onDelete: () => void
  deleting?: boolean
}> = ({ session, inWorkspace, onDelete, deleting }) => {
  const failed = session.bot_status === 'failed'
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl rounded-card border p-6',
        failed
          ? inWorkspace ? 'border-w-danger/50 bg-w-danger/10 text-w-danger' : 'border-red-300 bg-red-50 text-red-800'
          : inWorkspace ? 'border-w-line bg-w-panel text-w-ink' : 'border-p-line bg-white text-p-text',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        {failed ? <AlertCircle className="h-7 w-7 shrink-0" /> : <Loader2 className="h-7 w-7 shrink-0 animate-spin" />}
        <div className="min-w-0">
          <p className="text-lg font-black leading-tight">{failed ? 'Не получилось собрать конспект' : 'Распознаём запись…'}</p>
          <p className="mt-1 text-sm opacity-85">
            {failed
              ? session.bot_status_message || 'Что-то пошло не так. Попробуйте загрузить файл ещё раз.'
              : 'Обычно это пара минут на час разговора. Страницу можно закрыть — пришлём уведомление «Конспект готов».'}
          </p>
        </div>
      </div>
      {failed && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" onClick={onDelete} disabled={deleting}>
            <Trash2 className="mr-2 h-4 w-4" />
            {deleting ? 'Удаляем…' : 'Удалить сессию'}
          </Button>
        </div>
      )}
    </div>
  )
}
