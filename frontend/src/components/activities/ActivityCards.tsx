import type { ReactNode } from 'react'
import type { Activity, Intake, Participation } from '@/api/activities'
import { cn } from '@/lib/utils'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { dateSummary, directionTone, intakeCost, intakeLabel, intakeWhen } from '@/lib/activityUi'
import { ActivityTags, AssignmentText } from './ActivityParts'

/** В каком состоянии активность у ученика: решает, что показать на карточке. */
export type PlanState = 'none' | 'suggested' | 'in_plan' | 'achievement' | 'declined'

export function planStateOf(participation: Participation | undefined): PlanState {
  if (!participation) return 'none'
  if (participation.decision === 'suggested') return 'suggested'
  if (participation.decision === 'not_interested' || participation.status === 'cancelled') return 'declined'
  if (participation.status === 'completed' || participation.result_review_status === 'approved') return 'achievement'
  return 'in_plan'
}

const STATE_CHIP: Record<Exclude<PlanState, 'none'>, { label: string; className: string }> = {
  suggested: { label: 'Рекомендация', className: 'bg-ds-panel2 text-ds-ink' },
  in_plan: { label: 'В плане', className: 'bg-ds-panel2 text-ds-ink' },
  achievement: { label: 'Достижение', className: 'bg-ds-good/15 text-ds-good' },
  declined: { label: 'Не участвую', className: 'bg-ds-panel2 text-ds-muted' },
}

/** Только известные факты: «уточняется» на карточке не показываем. */
function knownFacts(intake: Intake | null | undefined): string[] {
  const facts: string[] = []
  if (intake?.format?.trim()) facts.push(intake.format.trim())
  if (intake?.cost_state === 'free' || intake?.cost_state === 'paid') facts.push(intakeCost(intake))
  return facts
}

/** Карточка каталога ученика (и превью у ментора). */
export function ActivityCatalogCard({ activity, planState = 'none', onOpen, onAdd, adding, preview, unavailableReason, hidePlanAction }: {
  activity: Activity; planState?: PlanState; onOpen?: () => void; onAdd?: () => void; adding?: boolean; preview?: boolean; unavailableReason?: string; hidePlanAction?: boolean
}) {
  const when = dateSummary(activity)
  const facts = knownFacts(activity.next_intake)
  const canAdd = !!activity.next_intake && when.state !== 'closed' && !unavailableReason
  const chip = planState !== 'none' ? STATE_CHIP[planState] : null
  const showAdd = !hidePlanAction && (planState === 'none' || planState === 'suggested' || planState === 'declined')
  return <article className="flex min-w-0 flex-col rounded-card border border-ds-line bg-ds-panel p-5 transition hover:border-ds-muted2">
    <div className="flex items-start justify-between gap-3">
      <ActivityTags activity={activity} />
      {chip
        ? <span className={cn('shrink-0 rounded-pill px-2.5 py-1 text-2xs font-bold', chip.className)}>{chip.label}</span>
        : <span title={when.hint} className={cn('shrink-0 text-xs font-semibold', when.state === 'closed' ? 'text-ds-danger' : 'text-ds-muted')}>{when.short}</span>}
    </div>
    <h3 className="mt-3 break-words text-lg font-bold leading-snug">{activity.title}</h3>
    {activity.description?.trim() && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ds-muted">{activity.description}</p>}
    {(facts.length > 0 || chip) && <p className="mt-3 text-xs text-ds-muted">{[chip ? when.short : null, ...facts].filter(Boolean).join(' · ')}</p>}
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
      {showAdd && <button type="button" onClick={onAdd} disabled={preview || adding || !canAdd}
        title={canAdd ? undefined : unavailableReason || 'Набор закрыт'}
        aria-label={canAdd ? `${planState === 'declined' ? 'Вернуть в план' : 'Добавить в план'}: ${activity.title}` : unavailableReason || 'Набор закрыт, добавить нельзя'}
        className="inline-flex flex-1 items-center justify-center rounded-ctl border border-ds-ink px-4 py-2.5 text-sm font-bold text-ds-ink transition hover:bg-ds-panel2 disabled:cursor-not-allowed disabled:border-ds-line disabled:text-ds-muted">
        {planState === 'declined' ? 'Вернуть в план' : 'Добавить в план'}
      </button>}
      <button type="button" onClick={onOpen} disabled={preview}
        className="px-2 py-2.5 text-sm font-semibold text-ds-ink underline underline-offset-4 disabled:cursor-default">
        Подробнее
      </button>
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
      <ActivityTags activity={activity} />
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
