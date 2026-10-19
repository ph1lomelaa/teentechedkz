import React from 'react'
import { AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { UploadRecordPanel } from './UploadRecordPanel'
import { cn } from '@/lib/utils'
import type { NoteSessionDetail } from '@/types'

/** После загрузки файла: «Распознаём запись…» или понятная причина сбоя. */
export const UploadStatusView: React.FC<{
  session: NoteSessionDetail
  inWorkspace: boolean
  onDelete: () => void
  deleting?: boolean
  onUploaded: () => void
}> = ({ session, inWorkspace, onDelete, deleting, onUploaded }) => {
  const failed = session.bot_status === 'failed'
  const [retrySource, setRetrySource] = React.useState<'file' | 'drive'>('drive')
  const stage = session.bot_status === 'downloading' ? 'Скачиваем запись из Google Drive…' : session.bot_status === 'transcribing' ? 'Распознаём речь…' : 'Создаём конспект…'
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
          <p className="text-lg font-black leading-tight">{failed ? 'Не получилось собрать конспект' : stage}</p>
          <p className="mt-1 text-sm opacity-85">
            {failed
              ? session.bot_status_message || 'Что-то пошло не так. Попробуйте загрузить файл ещё раз.'
              : 'Обработка идёт на сервере. Страницу можно закрыть — пришлём уведомление «Конспект готов». Время зависит от длины записи.'}
          </p>
        </div>
      </div>
      {!failed && <ol aria-label="Этапы обработки" className="mt-4 flex flex-wrap gap-3 text-xs">
        {['Скачивание / загрузка', 'Распознавание речи', 'Создание конспекта'].map((label, index) => <li key={label} className={cn('rounded-full border px-3 py-1.5', index === (session.bot_status === 'downloading' ? 0 : session.bot_status === 'transcribing' ? 1 : 2) && 'font-bold border-current')}>{index + 1}. {label}</li>)}
      </ol>}
      {failed && <div className="mt-5 space-y-4">
        <div className="flex flex-wrap gap-2"><Button variant={retrySource === 'drive' ? 'default' : 'outline'} onClick={() => setRetrySource('drive')}>Повторить из Google Drive</Button><Button variant={retrySource === 'file' ? 'default' : 'outline'} onClick={() => setRetrySource('file')}>Загрузить запись</Button></div>
        <UploadRecordPanel session={session} inWorkspace={inWorkspace} source={retrySource} onUploaded={onUploaded} />
      </div>}
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
