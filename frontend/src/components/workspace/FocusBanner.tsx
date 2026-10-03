import React from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Clock3, Route, ShieldAlert } from 'lucide-react'
import { Avatar } from '@/components/ui'
import type { Focus } from '@/lib/studentSignals'

const ICON: Record<Focus['kind'], React.ReactNode> = {
  incident: <ShieldAlert className="h-5 w-5" />,
  overdue: <Clock3 className="h-5 w-5" />,
  review: <ClipboardCheck className="h-5 w-5" />,
  roadmap: <Route className="h-5 w-5" />,
}

/** Одна главная проблема дня и одна кнопка. Остальное — в «Срочном». */
export const FocusBanner: React.FC<{ focus: Focus }> = ({ focus }) => {
  const shown = (focus.people ?? []).slice(0, 4)
  const rest = (focus.people?.length ?? 0) - shown.length
  return (
    <section aria-label="Главное сейчас" className="flex flex-col gap-4 rounded-card border border-w-accentDim/60 bg-w-accent/[.07] p-5 sm:flex-row sm:items-center sm:gap-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-panel bg-w-accent/15 text-w-accentText">{ICON[focus.kind]}</span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-extrabold leading-tight text-w-ink">{focus.title}</h2>
        <p className="mt-1 text-sm text-w-muted">{focus.description}</p>
      </div>
      {shown.length > 0 && (
        <div className="hidden shrink-0 items-center md:flex" aria-hidden="true">
          {shown.map((name, i) => <Avatar key={name + i} name={name} size={34} className={i ? '-ml-2 ring-2 ring-w-panel' : 'ring-2 ring-w-panel'} />)}
          {rest > 0 && <span className="-ml-2 grid h-[34px] min-w-[34px] place-items-center rounded-ctl border border-w-line bg-w-panel2 px-1.5 text-xs font-bold text-w-muted ring-2 ring-w-panel">+{rest}</span>}
        </div>
      )}
      <Link to={focus.href} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-ctl bg-w-accent px-5 text-sm font-black text-black transition hover:-translate-y-px">
        {focus.action}
      </Link>
    </section>
  )
}
