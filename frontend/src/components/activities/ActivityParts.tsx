import type { ReactNode } from 'react'
import type { Activity, StepsSummary } from '@/api/activities'
import { cn } from '@/lib/utils'
import { PUBLICATION, cleanDirection, directionTone, progressSegments } from '@/lib/activityUi'

/** «IT / Программирование · Курс». Цвет — по номеру направления из данных. */
export function DirectionBadge({ direction, kind, className }: { direction: string | null; kind?: string | null; className?: string }) {
  const label = [cleanDirection(direction) || null, kind || null].filter(Boolean).join(' · ') || 'Без направления'
  return <span title={label} className={cn('inline-flex max-w-full items-center truncate rounded-pill px-2.5 py-1 text-2xs font-bold', directionTone(direction).badge, className)}>
    {label}
  </span>
}

/** Точка + текст: статус никогда не передаётся одним цветом. */
export function PublicationStatus({ publication }: { publication: Activity['publication'] }) {
  const meta = PUBLICATION[publication]
  return <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
    <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />{meta.label}
  </span>
}

const SEGMENT: Record<'done' | 'pending' | 'todo', string> = {
  done: 'bg-ds-good',
  pending: 'bg-ds-info',
  todo: 'bg-ds-line',
}

/** Прогресс сегментами — по одному на обязательный шаг. */
export function ProgressSegments({ steps, className }: { steps: StepsSummary | undefined; className?: string }) {
  const segments = progressSegments(steps)
  if (!segments.length) return null
  return <div role="img" aria-label={`Выполнено ${steps!.done} из ${steps!.total}${steps!.pending ? `, на проверке ${steps!.pending}` : ''}`}
    className={cn('flex gap-1', className)}>
    {segments.map((state, index) => <span key={index} className={cn('h-1.5 flex-1 rounded-full', SEGMENT[state])} />)}
  </div>
}

/** Задание: если в тексте есть нумерация или маркеры — нумерованные шаги, иначе абзац. */
export function AssignmentText({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const marked = lines.filter((line) => /^(\d+[.)]|[-•*–])\s+/.test(line))
  if (lines.length > 1 && marked.length >= Math.ceil(lines.length / 2)) {
    return <ol className="space-y-3">
      {lines.map((line, index) => <li key={index} className="flex gap-3 text-sm leading-relaxed">
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ds-panel2 text-2xs font-bold text-ds-muted">{index + 1}</span>
        <span className="min-w-0 break-words pt-0.5">{line.replace(/^(\d+[.)]|[-•*–])\s+/, '')}</span>
      </li>)}
    </ol>
  }
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
}

/** Подпись-«эйбрау» над заголовком раздела. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-2xs font-bold uppercase tracking-caps text-ds-muted', className)}>{children}</p>
}

/** Чип фильтра со счётчиком. Активный — инверсия, а не жёлтый: жёлтый занят главным действием. */
export function FilterChip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return <button type="button" aria-pressed={active} onClick={onClick}
    className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-dim',
      active ? 'border-ds-ink bg-ds-ink text-ds-bg' : 'border-ds-line bg-ds-panel text-ds-muted hover:border-ds-muted2 hover:text-ds-ink')}>
    {children}{count !== undefined && <span className={active ? 'opacity-70' : 'text-ds-muted2'}>{count}</span>}
  </button>
}

/** Вкладки раздела: подчёркивание акцентом у активной. */
export function UnderlineTabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: Array<{ value: T; label: ReactNode }>; value: T; onChange: (value: T) => void; label: string
}) {
  return <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto border-b border-ds-line">
    {tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} onClick={() => onChange(tab.value)}
      className={cn('-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-dim',
        value === tab.value ? 'border-ds-accent text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink')}>
      {tab.label}
    </button>)}
  </div>
}
