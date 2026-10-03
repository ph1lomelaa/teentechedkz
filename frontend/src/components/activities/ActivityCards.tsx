import type { ReactNode } from 'react'
import { ArrowUpRight, Check, Plus, Sparkles } from 'lucide-react'
import type { Activity, Intake, Participation } from '@/api/activities'
import { cn } from '@/lib/utils'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { dateSummary, directionTone, intakeCost, intakeLabel, intakeWhen } from '@/lib/activityUi'
import { AssignmentText, DirectionBadge } from './ActivityParts'

/** В каком состоянии активность у ученика: решает, что показать вместо «+». */
export type PlanState = 'none' | 'suggested' | 'in_plan' | 'declined'

export function planStateOf(participation: Participation | undefined): PlanState {
  if (!participation) return 'none'
  if (participation.decision === 'suggested') return 'suggested'
  if (participation.decision === 'not_interested' || participation.status === 'cancelled') return 'declined'
  return 'in_plan'
}

/** Карточка каталога ученика (и превью у ментора). */
export function ActivityCatalogCard({ activity, planState = 'none', onOpen, onAdd, adding, preview, unavailableReason, hidePlanAction }: {
  activity: Activity; planState?: PlanState; onOpen?: () => void; onAdd?: () => void; adding?: boolean; preview?: boolean; unavailableReason?: string; hidePlanAction?: boolean
}) {
  const when = dateSummary(activity)
  const recommended = planState === 'suggested'
  const facts = [activity.next_intake?.format || 'Формат уточняется', intakeCost(activity.next_intake)].filter(Boolean) as string[]
  const canAdd = !!activity.next_intake && when.state !== 'closed' && !unavailableReason
  return <article className={cn('relative flex min-w-0 flex-col rounded-card border bg-ds-panel p-5 transition',
    recommended ? 'border-ds-accent' : 'border-ds-line hover:border-ds-muted2')}>
    {recommended && <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-pill border border-ds-accent-dim bg-ds-panel px-2 py-0.5 text-2xs font-bold text-ds-accentText">
      <Sparkles className="h-3 w-3" aria-hidden />от ментора
    </span>}
    <div className="flex items-start justify-between gap-3">
      <DirectionBadge direction={activity.direction} kind={activity.kind} className="min-w-0" />
      <span title={when.hint} className={cn('shrink-0 text-xs font-semibold', when.state === 'closed' ? 'text-ds-danger' : 'text-ds-muted')}>{when.short}</span>
    </div>
    <h3 title={activity.title} className="mt-3 line-clamp-2 break-words text-lg font-bold leading-snug">{activity.title}</h3>
    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ds-muted">{activity.description || [activity.organizer, activity.country].filter(Boolean).join(' · ') || 'Описание уточняется'}</p>
    <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Коротко">
      {facts.map((fact) => <li key={fact} className="rounded-ctl bg-ds-panel2 px-2 py-1 text-xs text-ds-muted">{fact}</li>)}
    </ul>
    <div className="mt-auto flex items-center gap-2 pt-5">
      <button type="button" onClick={onOpen} disabled={preview}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-ctl border border-ds-line px-4 py-2.5 text-sm font-bold text-ds-ink transition hover:border-ds-muted2 disabled:cursor-default">
        Подробнее <ArrowUpRight className="h-4 w-4" aria-hidden />
      </button>
      {!hidePlanAction && (planState === 'in_plan'
        ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-ctl bg-ds-good/15 px-2 py-2.5 text-xs font-bold text-ds-good"><Check className="h-4 w-4" aria-hidden />В моём плане</span>
        : <button type="button" onClick={onAdd} disabled={preview || adding || !canAdd}
            aria-label={canAdd ? `Добавить в план: ${activity.title}` : unavailableReason || 'Набор закрыт — добавить нельзя'}
            title={canAdd ? 'Добавить в мой план' : unavailableReason || 'Набор закрыт'}
            className={cn('grid h-[42px] w-[42px] shrink-0 place-items-center rounded-ctl border transition disabled:cursor-not-allowed disabled:opacity-50',
              'border-ds-line text-ds-ink hover:border-ds-accent-dim')}>
            <Plus className="h-5 w-5" aria-hidden />
          </button>)}
    </div>
  </article>
}

function FactTile({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-panel bg-ds-panel/70 px-3 py-2.5">
    <dt className="truncate text-2xs font-bold uppercase tracking-wide text-ds-muted" title={label}>{label}</dt>
    <dd title={value} className="mt-1 truncate text-sm font-semibold">{value}</dd>
  </div>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3">
    <h2 className="text-base font-bold">{title}</h2>
    {children}
  </section>
}

function intakeWhenFull(intake: Intake): string {
  if (intake.deadline) return `Дедлайн организатора: ${formatDeadline(intake.deadline)}`
  return intakeWhen(intake)
}

/** Полная карточка активности: шапка в цвете направления, разделы, панель действий. */
export function ActivityDetailView({ activity, intakes, aside }: { activity: Activity; intakes: Intake[]; aside?: ReactNode }) {
  const tone = directionTone(activity.direction)
  const when = dateSummary(activity)
  const near = activity.next_intake ?? null
  return <div className="space-y-6">
    <header className={cn('rounded-card border p-5 sm:p-7', tone.soft, tone.line)}>
      <DirectionBadge direction={activity.direction} kind={activity.kind} />
      <h1 className="mt-3 break-words text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{activity.title}</h1>
      <p className="mt-2 text-sm text-ds-muted">{[activity.organizer, activity.country].filter(Boolean).join(' · ') || 'Организатор уточняется'}</p>
      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <FactTile label="Подача" value={when.short} />
        <FactTile label="Формат" value={near?.format || 'Уточняется'} />
        <FactTile label="Стоимость" value={intakeCost(near)} />
        
      </dl>
    </header>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-7">
        <Section title="О чём это">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{activity.description || 'Описание пока не добавлено. Подробности — на сайте организатора.'}</p>
        </Section>
        <Section title="Кто может участвовать">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{activity.eligibility || 'Требования уточняются — спросите ментора.'}</p>
        </Section>
        <Section title="Что нужно сделать">
          {activity.assignment ? <AssignmentText text={activity.assignment} /> : <p className="text-sm text-ds-muted">Задание уточняется. Ментор разобьёт его на шаги в вашем плане.</p>}
        </Section>
        <Section title="Сроки">
          {intakes.length ? <ul className="divide-y divide-ds-line rounded-panel border border-ds-line bg-ds-panel">
            {intakes.map((intake) => <li key={intake.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-semibold">{intakeLabel(intake) ?? 'Основной набор'}</span>
              <span className="text-ds-muted">{intakeWhenFull(intake)}</span>
            </li>)}
          </ul> : <p className="text-sm text-ds-muted">Дата неизвестна — организатор ещё не объявил набор.</p>}
        </Section>
      </div>
      {aside && <aside className="lg:sticky lg:top-6 lg:self-start">{aside}</aside>}
    </div>
  </div>
}
