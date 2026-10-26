import type { ReactNode } from 'react'
import type { Activity, ExperienceKey, StepsSummary } from '@/api/activities'
import { cn } from '@/lib/utils'
import { EXPERIENCE_LABEL, EXPERIENCE_TYPES, PUBLICATION, cleanDirection, directionTone, progressSegments } from '@/lib/activityUi'

/** Направление цветом из данных. Тип опыта — отдельный чип (`ActivityTags`), `kind` его не заменяет. */
export function DirectionBadge({ direction, className }: { direction: string | null; kind?: string | null; className?: string }) {
  const label = cleanDirection(direction) || 'Без направления'
  return <span className={cn('inline-flex max-w-full items-center rounded-pill px-2.5 py-1 text-2xs font-bold leading-tight', directionTone(direction).badge, className)}>
    {label}
  </span>
}

/** Направление и тип опыта двумя чипами; не обрезаются, а переносятся. */
export function ActivityTags({ activity, className }: { activity: Pick<Activity, 'direction' | 'experience_type'>; className?: string }) {
  return <span className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
    <DirectionBadge direction={activity.direction} />
    <span className="inline-flex items-center rounded-pill bg-ds-panel2 px-2.5 py-1 text-2xs font-bold leading-tight text-ds-muted">{EXPERIENCE_LABEL[activity.experience_type ?? 'other']}</span>
  </span>
}

/**
 * Фильтр одной строкой текста: «Все · Нужно от меня 2 · Без фокуса 1».
 * Активный пункт жирный с жёлтой чертой снизу; пункты с нулём скрыты (кроме активного).
 */
export function FilterBar<T extends string>({ options, value, onChange, label }: {
  options: Array<{ value: T; label: ReactNode; count?: number }>; value: T; onChange: (value: T) => void; label: string
}) {
  return <div role="group" aria-label={label} className="scroll-row -mx-4 flex gap-5 px-4 sm:mx-0 sm:px-0">
    {options.filter((o) => o.value === value || o.count === undefined || o.count > 0).map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
      className={cn('inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap border-b-2 pb-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-dim',
        value === o.value ? 'border-ds-accent font-bold text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink')}>
      {o.label}{o.count !== undefined && o.count > 0 && <span className="text-xs font-normal text-ds-muted2">{o.count}</span>}
    </button>)}
  </div>
}

/** Компактный выпадающий фильтр «Тип опыта: все ▾». Числа внутри списка, а не на экране. */
export function FilterSelect<T extends string>({ label, options, value, onChange, lowercase = true }: {
  lowercase?: boolean; label: string; options: Array<{ value: T; label: string; count?: number }>; value: T | ''; onChange: (value: T | '') => void
}) {
  const shown = options.find((o) => o.value === value)?.label
  return <label className={cn('relative inline-flex shrink-0 items-center gap-1 rounded-ctl border px-3 py-2 text-sm transition focus-within:ring-2 focus-within:ring-ds-accent-dim',
    value ? 'border-ds-ink font-bold text-ds-ink' : 'border-ds-line text-ds-muted hover:border-ds-muted2')}>
    <span>{label}:</span>
    <span className={value ? '' : 'text-ds-ink'}>{shown ? (lowercase ? shown.toLocaleLowerCase('ru') : shown) : 'все'}</span>
    <span aria-hidden className="text-xs">▾</span>
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T | '')} className="absolute inset-0 cursor-pointer opacity-0">
      <option value="">Все</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.count !== undefined ? ` · ${o.count}` : ''}</option>)}
    </select>
  </label>
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
  return <div role="img" aria-label={`Готово ${steps!.done} из ${steps!.total}${steps!.pending ? `, на проверке ${steps!.pending}` : ''}`}
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
  return <div role="tablist" aria-label={label} className="scroll-row flex gap-6 shadow-[inset_0_-1px_0_rgb(var(--ds-line-rgb))]">
    {tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} onClick={() => onChange(tab.value)}
      className={cn('inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-dim',
        value === tab.value ? 'border-ds-accent text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink')}>
      {tab.label}
    </button>)}
  </div>
}

/** Фильтр по типу опыта — сюда ведёт «Подобрать» из плитки «Типы опыта». */
export function ExperienceChips({ items, value, onChange }: { items: Array<Pick<Activity, 'experience_type'>>; value: ExperienceKey | ''; onChange: (value: ExperienceKey | '') => void }) {
  const count = (key: ExperienceKey) => items.filter((a) => (a.experience_type ?? 'other') === key).length
  return <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Тип опыта">
    <FilterChip active={!value} onClick={() => onChange('')}>Любой тип</FilterChip>
    {EXPERIENCE_TYPES.filter((t) => count(t.key)).map((t) => <FilterChip key={t.key} active={value === t.key} onClick={() => onChange(value === t.key ? '' : t.key)} count={count(t.key)}>{t.short}</FilterChip>)}
  </div>
}
