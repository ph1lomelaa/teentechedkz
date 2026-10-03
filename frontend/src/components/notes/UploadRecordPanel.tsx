import React, { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileAudio, Loader2, Upload } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import { LanguagePicker } from '@/components/notes/LanguagePicker'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { formatFileSize, isAcceptedRecordingFile, MAX_RECORDING_FILE_BYTES, RECORDING_FILE_ACCEPT } from '@/lib/meetingBotUi'
import type { NoteSession, NoteSessionDetail, NoteSessionLanguage } from '@/types'

/**
 * «Загрузить запись»: звонок в Telegram или WhatsApp, по телефону, встреча
 * вживую — всё, куда бот зайти не может. После загрузки сервер сам распознаёт
 * файл и присылает «Конспект готов».
 */
export const UploadRecordPanel: React.FC<{
  session: NoteSessionDetail
  inWorkspace: boolean
  onUploaded: (session: NoteSession) => void
}> = ({ session, inWorkspace, onUploaded }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState<NoteSessionLanguage>(session.language ?? 'ru')
  const [progress, setProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileError = file && !isAcceptedRecordingFile(file)
    ? file.size > MAX_RECORDING_FILE_BYTES
      ? `Файл больше ${formatFileSize(MAX_RECORDING_FILE_BYTES)}. Сократите запись или сохраните её в mp3/m4a.`
      : 'Это не похоже на аудио или видео. Подойдут mp3, m4a, wav, ogg, opus, webm, mp4, mov.'
    : null

  const uploadMutation = useMutation({
    mutationFn: () => notesApi.uploadAudio(session.id, file!, language, setProgress),
    onSuccess: onUploaded,
    onError: () => setProgress(0),
  })

  const ink = inWorkspace ? 'text-w-ink' : 'text-p-text'
  const muted = inWorkspace ? 'text-w-muted' : 'text-p-muted'

  const pick = (picked: File | undefined | null) => {
    if (!picked) return
    setFile(picked)
    uploadMutation.reset()
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          pick(event.dataTransfer.files?.[0])
        }}
        disabled={uploadMutation.isPending}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-panel border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragOver
            ? 'border-[#FFD400] bg-[#FFD400]/10'
            : inWorkspace ? 'border-w-line hover:border-w-accentDim' : 'border-p-line hover:border-p-muted2',
        )}
      >
        {file ? <FileAudio className={cn('h-8 w-8', ink)} /> : <Upload className={cn('h-8 w-8', muted)} />}
        {file ? (
          <>
            <span className={cn('max-w-full truncate font-semibold', ink)}>{file.name}</span>
            <span className={cn('text-xs', muted)}>{formatFileSize(file.size)} · нажмите, чтобы выбрать другой</span>
          </>
        ) : (
          <>
            <span className={cn('font-semibold', ink)}>Перетащите файл сюда или нажмите, чтобы выбрать</span>
            <span className={cn('text-xs', muted)}>
              Запись звонка с телефона, из Telegram или WhatsApp, файл встречи — mp3, m4a, ogg, wav, mp4. До {formatFileSize(MAX_RECORDING_FILE_BYTES)}.
            </span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={RECORDING_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {fileError && (
        <div className={cn('rounded-panel border p-3 text-sm', inWorkspace ? 'border-w-danger/50 bg-w-danger/10 text-w-danger' : 'border-red-300 bg-red-50 text-red-800')}>
          {fileError}
        </div>
      )}

      <LanguagePicker value={language} onChange={setLanguage} inWorkspace={inWorkspace} disabled={uploadMutation.isPending} />

      {uploadMutation.isError && (
        <div className={cn('rounded-panel border p-3 text-sm', inWorkspace ? 'border-w-danger/50 bg-w-danger/10 text-w-danger' : 'border-red-300 bg-red-50 text-red-800')}>
          {getErrorMessage(uploadMutation.error, 'Не удалось загрузить файл. Проверьте интернет и попробуйте ещё раз.')}
        </div>
      )}

      {uploadMutation.isPending && (
        <div>
          <div className={cn('h-2 overflow-hidden rounded-full', inWorkspace ? 'bg-w-line' : 'bg-p-line')}>
            <div className="h-full rounded-full bg-[#FFD400] transition-all" style={{ width: `${Math.max(3, progress)}%` }} />
          </div>
          <p className={cn('mt-1.5 text-xs', muted)}>Загружаем… {progress}% — не закрывайте страницу до конца загрузки.</p>
        </div>
      )}

      <Button
        size="lg"
        className={cn('h-14 w-full text-base', inWorkspace && 'rounded-ctl bg-w-accent font-black text-black hover:bg-w-accent/90')}
        disabled={!file || Boolean(fileError) || uploadMutation.isPending}
        onClick={() => uploadMutation.mutate()}
      >
        {uploadMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Upload className="mr-2 h-5 w-5" />}
        Загрузить и собрать конспект
      </Button>
      <p className={cn('text-center text-xs', muted)}>
        Распознаём запись на сервере — обычно пара минут на час разговора. Страницу можно закрыть, пришлём уведомление «Конспект готов».
      </p>
    </div>
  )
}
