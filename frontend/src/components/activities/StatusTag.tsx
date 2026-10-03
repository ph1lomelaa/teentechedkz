import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type TagTone = 'accent' | 'neutral' | 'good' | 'danger' | 'info'

// Мягкие плашки: тон — полупрозрачный фон и текст того же токена. Токены
// ds-good/ds-danger подобраны под чтение текстом в обеих темах; сплошная
// заливка с чёрным текстом (как у Pill) в светлой теме становится нечитаемой.
const TONE: Record<TagTone, string> = {
  accent: 'bg-ds-accent text-black',
  neutral: 'bg-ds-line text-ds-muted',
  good: 'bg-ds-good/15 text-ds-good',
  danger: 'bg-ds-danger/15 text-ds-danger',
  info: 'bg-ds-info/15 text-ds-info',
}

export function StatusTag({ tone = 'neutral', className, children }: { tone?: TagTone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-3 py-1 text-2xs font-bold', TONE[tone], className)}>{children}</span>
}
