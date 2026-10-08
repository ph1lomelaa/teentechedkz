import React from 'react'
import { Video } from 'lucide-react'
import { cn } from '@/lib/utils'

/** meet.google.com/new создаёт встречу в аккаунте Google, под которым вошёл ментор. */
export const GOOGLE_MEET_NEW_URL = 'https://meet.google.com/new'

/**
 * «Создать Google Meet» — открывает новую встречу в соседней вкладке; ментор
 * копирует её ссылку и вставляет в поле. Meet — основной путь для бота-
 * конспектора: в Zoom бот не заходит, пока Zoom не одобрил наше приложение.
 */
export const CreateGoogleMeetLink: React.FC<{ className?: string; label?: string }> = ({
  className,
  label = 'Создать Google Meet',
}) => (
  <a
    href={GOOGLE_MEET_NEW_URL}
    target="_blank"
    rel="noopener noreferrer"
    className={cn('inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-4', className)}
  >
    <Video className="h-3.5 w-3.5" />
    {label}
  </a>
)
