import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/portfolio/dictionary'

/**
 * Комментарий ментора: имя, дата, текст. Один стиль во всём разделе:
 * нейтральная плашка с красной полосой слева. `compact` — одна строка с обрезкой.
 */
export function MentorComment({ text, author, at, compact = false, className }: {
  text: string; author?: string | null; at?: string | null; compact?: boolean; className?: string
}) {
  const who = [author, at ? formatDay(at) : null].filter(Boolean).join(' · ')
  if (compact) {
    return <p className={cn('truncate border-l-2 border-ds-danger pl-2 text-xs text-ds-muted', className)} title={text}>
      {author ? <b className="font-semibold text-ds-ink">{author}: </b> : null}{text}
    </p>
  }
  return <div className={cn('rounded-ctl border-l-2 border-ds-danger bg-ds-panel2 p-3 text-sm', className)}>
    <p className="mb-1 text-xs font-semibold text-ds-muted">{who || 'Комментарий ментора'}</p>
    <p className="whitespace-pre-wrap break-words">{text}</p>
  </div>
}
