/**
 * Общие блоки портфолио: «Сейчас», «Типы опыта», фокус ментора, ближайший срок.
 * Одни и те же у ученика (раздел и главная), в карточке ученика и у ментора —
 * поэтому раздел и выглядит, и читается одинаково везде.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, Check, Clock, MessageSquareQuote, Plus } from 'lucide-react'
import { activitiesApi, type ExperienceKey, type ExperienceTile, type NextDeadline, type Participation, type PortfolioAction, type PortfolioCounts, type PortfolioFocus } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { cn } from '@/lib/utils'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { getErrorMessage } from '@/lib/errorMessage'
import { EXPERIENCE_TYPES, actionCopy, participationPath } from '@/lib/activityUi'
import { pluralRu } from '@/lib/contextDraft'
import { useAddToPlan, useDecline } from './useStudentActivities'
import { SHELF_TYPES } from '@/lib/portfolio/dictionary'
import { MentorComment } from './shared/MentorComment'

type Viewer = 'student' | 'staff'
const EXPERIENCE_SHORT = Object.fromEntries(EXPERIENCE_TYPES.map((t) => [t.key, t.short])) as Record<ExperienceTile['key'], string>

export function PanelTitle({ id, children, hint }: { id: string; children: ReactNode; hint?: ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id={id} className="text-base font-bold">{children}</h2>
    {hint && <div className="text-xs text-ds-muted">{hint}</div>}
  </div>
}

/** «2 достижения · 1 в работе · 1 рекомендация» — одна строка вместо четырёх плашек. */
export function PortfolioNumbers({ counts, className }: { counts: PortfolioCounts; className?: string }) {
  const parts: Array<[number, string, string]> = [
    [counts.confirmed, pluralRu(counts.confirmed, 'достижение', 'достижения', 'достижений'), 'text-ds-good'],
    [counts.active, 'в работе', 'text-ds-ink'],
    [counts.suggested, pluralRu(counts.suggested, 'рекомендация', 'рекомендации', 'рекомендаций'), 'text-ds-ink'],
  ]
  return <p className={cn('flex flex-wrap gap-x-4 gap-y-1 text-sm text-ds-muted', className)}>
    {parts.map(([n, label, tone]) => <span key={label}><b className={cn('text-base font-extrabold', n ? tone : 'text-ds-muted')}>{n}</b> {label}</span>)}
    {counts.overdue > 0 && <span className="font-semibold text-ds-danger">просрочено шагов: {counts.overdue}</span>}
  </p>
}

// ------------------------------------------------------------------ «Сейчас»

function ActionItem({ action, viewer, plan, primary }: { action: PortfolioAction; viewer: Viewer; plan?: Participation[]; primary: boolean }) {
  const copy = actionCopy(action, viewer)
  const base = viewer === 'student' ? '/portal' : '/workspace'
  const add = useAddToPlan()
  const decline = useDecline()
  const suggestion = action.kind === 'decide' && viewer === 'student' ? plan?.find((p) => p.id === action.participation_id) : undefined
  const busy = add.isPending || decline.isPending
  const calm = copy.tone === 'calm'
  const path = participationPath(base, action)
  const button = (label: string, to: string) => <Link to={to} className={cn('inline-flex shrink-0 items-center rounded-ctl px-4 py-2 text-sm font-bold transition',
    primary ? 'bg-ds-accent text-black hover:brightness-95' : 'border border-ds-line hover:border-ds-muted2')}>{label}</Link>
  return <li className="flex gap-3 px-4 py-3.5 sm:px-5">
    <span aria-hidden className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full',
      copy.tone === 'urgent' ? 'bg-ds-danger/15 text-ds-danger' : 'bg-ds-panel2 text-ds-muted')}>
      {calm ? <Clock className="h-4 w-4" /> : copy.tone === 'urgent' ? <span className="text-sm font-black">!</span> : <ArrowRight className="h-4 w-4" />}
    </span>
    <div className="min-w-0 flex-1 space-y-1.5">
      {suggestion
        ? <Link to={path} className="block break-words text-sm font-bold hover:underline">{copy.title}</Link>
        : <p className={cn('break-words text-sm font-bold', calm && 'font-semibold text-ds-muted')}>{copy.title}</p>}
      <p className="break-words text-xs text-ds-muted">{viewer === 'staff' && action.student_name ? `${action.student_name} · ` : ''}{copy.detail}</p>
      {action.comment && <MentorComment compact text={action.comment} author={action.comment_by} />}
      {action.kind === 'decide' && action.reason && <p className="border-l-2 border-ds-line pl-2 text-xs italic text-ds-muted">«{action.reason}»</p>}
      {suggestion ? <div className="flex flex-wrap items-center gap-3 pt-1">
        <AppButton size="sm" variant={primary ? undefined : 'subtle'} disabled={busy} onClick={() => add.mutate({ intakeId: suggestion.intake_id, existing: suggestion })}>Добавить в план</AppButton>
        <button type="button" disabled={busy} onClick={() => decline.mutate(suggestion)} className="text-sm font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Не интересно</button>
      </div> : copy.cta ? <div className="flex flex-wrap items-center gap-3 pt-1">
        {button(copy.cta, path)}
        {viewer === 'student' && action.kind === 'do_step' && action.overdue && <Link to="/portal/chat" className="text-sm font-semibold underline underline-offset-4">Написать ментору</Link>}
      </div> : <Link to={path} className="inline-block text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Открыть</Link>}
    </div>
  </li>
}

/** Список «Сейчас»: жёлтая кнопка только у первого пункта, остальное доступно в «Участиях». */
export function NowList({ actions, viewer, plan, limit = 3, empty }: { actions: PortfolioAction[]; viewer: Viewer; plan?: Participation[]; limit?: number; empty: ReactNode }) {
  const [all, setAll] = useState(false)
  if (!actions.length) return <div className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">{empty}</div>
  const shown = all ? actions : actions.slice(0, limit)
  return <div className="overflow-hidden rounded-card border border-ds-line bg-ds-panel">
    <ul className="divide-y divide-ds-line">
      {shown.map((action, i) => <ActionItem key={`${action.kind}:${action.participation_id}`} action={action} viewer={viewer} plan={plan} primary={i === 0 && action.owner === (viewer === 'student' ? 'student' : 'mentor')} />)}
    </ul>
    {viewer === 'staff' && actions.length > limit && <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-ds-line px-5 py-2.5 text-left text-xs font-bold text-ds-muted hover:text-ds-ink">
      {all ? 'Свернуть' : `Показать все · ${actions.length}`}
    </button>}
  </div>
}

// ------------------------------------------------------------------ типы опыта

/**
 * Что есть и чего нет по типам опыта. Пустая плитка ведёт в каталог с этим
 * типом: ученику — подобрать самому, ментору — подобрать и рекомендовать.
 */
export function ExperienceStrip({ tiles, pickPath, wide = false }: { tiles: ExperienceTile[]; pickPath: (key: ExperienceTile['key']) => string; wide?: boolean }) {
  return <ul className={cn('grid grid-cols-2 gap-2', wide && 'sm:grid-cols-3')}>
    {tiles.map((tile) => {
      const has = tile.confirmed > 0
      return <li key={tile.key} className={cn('flex min-w-0 flex-col justify-between gap-2 rounded-panel border p-3', has ? 'border-ds-good/40 bg-ds-good/[0.06]' : 'border-ds-line bg-ds-panel')}>
        <p title={tile.label} className="text-xs font-bold leading-snug">{EXPERIENCE_SHORT[tile.key]}</p>
        {has || tile.active
          ? <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {has && <span className="inline-flex items-center gap-1 font-bold text-ds-good"><Check className="h-3.5 w-3.5" aria-hidden />{tile.confirmed}</span>}
              {tile.active > 0 && <span className="text-ds-info">в работе: {tile.active}</span>}
            </p>
          : <Link to={pickPath(tile.key)} className="inline-flex items-center gap-1 text-xs font-semibold text-ds-muted underline-offset-4 hover:text-ds-ink hover:underline">
              <Plus className="h-3.5 w-3.5" aria-hidden />Подобрать
            </Link>}
      </li>
    })}
  </ul>
}

// ------------------------------------------------------------------ фокус ментора

/** Фокус от ментора: что усилить. У сотрудника редактируется на месте. */
export function FocusNote({ focus, studentId, editable = false }: { focus: PortfolioFocus | null; studentId?: string; editable?: boolean }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(focus?.text ?? '')
  const [types, setTypes] = useState<ExperienceKey[]>(focus?.types ?? [])
  const save = useMutation({
    mutationFn: () => activitiesApi.setFocus(studentId!, text, types),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['activities'] }); setEditing(false) },
  })
  if (!focus && !editable) return <p className="text-xs text-ds-muted">Ментор напишет здесь, что усилить.</p>
  if (editing) return <div className="space-y-3 rounded-ctl border border-ds-line bg-ds-panel p-3">
    <label htmlFor="portfolio-focus" className="text-sm font-bold">Что усилить в портфолио</label>
    <Textarea id="portfolio-focus" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Например: не хватает стажировки, летом попробовать IT-стажировку" />
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-semibold text-ds-muted">Какие ячейки полки усилить</legend>
      <div className="flex flex-wrap gap-1.5">
        {SHELF_TYPES.map((t) => {
          const on = types.includes(t.key)
          return <button key={t.key} type="button" aria-pressed={on} onClick={() => setTypes(on ? types.filter((k) => k !== t.key) : [...types, t.key])}
            className={cn('rounded-pill border px-2.5 py-1 text-xs font-semibold', on ? 'border-ds-ink bg-ds-ink text-ds-bg' : 'border-ds-line text-ds-muted hover:text-ds-ink')}>{t.short}</button>
        })}
      </div>
    </fieldset>
    <p className="text-xs text-ds-muted">Ученик увидит фокус на полке и получит уведомление.</p>
    <div className="flex flex-wrap gap-2">
      <AppButton size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</AppButton>
      <AppButton size="sm" variant="subtle" onClick={() => { setText(focus?.text ?? ''); setTypes(focus?.types ?? []); setEditing(false) }}>Отмена</AppButton>
    </div>
    {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
  </div>
  return <section aria-label="Фокус от ментора" className="rounded-ctl bg-ds-panel2 p-3">
    <div className="flex items-start gap-3">
      <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">Фокус от ментора</p>
        {focus
          ? <><p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{focus.text}</p>
              <p className="mt-2 text-xs text-ds-muted">{[focus.updated_by_name, formatDeadline(focus.updated_at.slice(0, 10))].filter(Boolean).join(' · ')}</p></>
          : <p className="mt-1.5 text-sm text-ds-muted">Пока не задано. Напишите ученику 1–2 строки: чего не хватает и что сделать в ближайшие месяцы.</p>}
      </div>
      {editable && <button type="button" onClick={() => { setText(focus?.text ?? ''); setEditing(true) }} className="shrink-0 text-xs font-bold underline underline-offset-4">{focus ? 'Изменить' : 'Задать'}</button>}
    </div>
  </section>
}

export function NextDeadlineNote({ deadline, base }: { deadline: NextDeadline | null; base: '/portal' | '/workspace' }) {
  if (!deadline) return null
  return <Link to={`${base}/activities/participations/${deadline.participation_id}`} className="flex items-center gap-3 rounded-card border border-ds-line bg-ds-panel p-4 transition hover:border-ds-muted2">
    <CalendarClock className="h-5 w-5 shrink-0 text-ds-muted" aria-hidden />
    <span className="min-w-0">
      <span className="block text-xs text-ds-muted">Ближайший срок · {formatDeadline(deadline.date)}</span>
      <span className="block truncate text-sm font-bold">{deadline.title}</span>
    </span>
  </Link>
}
