import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { NEED_LABEL, type NeedWho } from '@/lib/portfolio/dictionary'

const TONE: Record<NeedWho, string> = {
  you: 'bg-ds-accent text-black',
  me: 'bg-ds-accent text-black',
  mentor: 'bg-ds-info/15 text-ds-info',
  student: 'bg-ds-info/15 text-ds-info',
  organizer: 'bg-ds-panel2 text-ds-muted',
}

/** «Нужно от вас · Айгерим вернула шаг 2 на правки 21 окт.» — кто действует и что. */
export function NeedLine({ who, children, className }: { who: NeedWho; children: ReactNode; className?: string }) {
  return <p className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
    <span className={cn('rounded-pill px-2.5 py-0.5 text-xs font-bold', TONE[who])}>{NEED_LABEL[who]}</span>
    <span className="min-w-0 break-words">{children}</span>
  </p>
}
