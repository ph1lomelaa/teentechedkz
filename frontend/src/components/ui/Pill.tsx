import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'
type Tone = 'neutral' | 'accent' | 'danger' | 'good'

interface PillProps {
  children: React.ReactNode
  tone?: Tone
  colorPrefix?: ColorPrefix
  className?: string
}

// Generic tone badge for arbitrary content (a name, a date, a source label) —
// distinct from StatusPill, which is locked to the four TaskStatus values.
const TONE_CLASS: Record<ColorPrefix, Record<Tone, string>> = {
  ds: {
    neutral: 'bg-ds-line text-ds-muted',
    accent: 'bg-ds-accent text-black',
    danger: 'bg-ds-danger text-black',
    good: 'bg-ds-good text-black',
  },
  p: {
    neutral: 'bg-p-line text-p-muted',
    accent: 'bg-p-accent text-black',
    danger: 'bg-p-danger text-black',
    good: 'bg-p-good text-black',
  },
  w: {
    neutral: 'bg-w-line text-w-muted',
    accent: 'bg-w-accent text-black',
    danger: 'bg-w-danger text-black',
    good: 'bg-w-good text-black',
  },
}

export const Pill: React.FC<PillProps> = ({ children, tone = 'neutral', colorPrefix = 'ds', className }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-pill px-3 py-1 text-2xs font-bold', TONE_CLASS[colorPrefix][tone], className)}>
    {children}
  </span>
)
