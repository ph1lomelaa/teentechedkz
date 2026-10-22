/**
 * Общие блоки портфолио: «Сейчас», «Типы опыта», фокус ментора, ближайший срок.
 * Одни и те же у ученика (раздел и главная), в карточке ученика и у ментора —
 * поэтому раздел и выглядит, и читается одинаково везде.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, Check, Clock, MessageSquareQuote, Plus } from 'lucide-react'
import { activitiesApi, type ExperienceTile, type NextDeadline, type Participation, type PortfolioAction, type PortfolioCounts, type PortfolioFocus } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { cn } from '@/lib/utils'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { getErrorMessage } from '@/lib/errorMessage'
import { EXPERIENCE_TYPES, actionCopy, participationPath } from '@/lib/activityUi'
import { useAddToPlan, useDecline } from './useStudentActivities'

type Viewer = 'student' | 'staff'
const EXPERIENCE_SHORT = Object.fromEntries(EXPERIENCE_TYPES.map((t) => [t.key, t.short])) as Record<ExperienceTile['key'], string>

export function PanelTitle({ id, children, hint }: { id: string; children: ReactNode; hint?: ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id={id} className="text-base font-bold">{children}</h2>
    {hint && <div className="text-xs text-ds-muted">{hint}</div>}
  </div>
}

/** «2 подтверждено · 1 в работе · 1 ждёт решения» — одна строка вместо четырёх плашек. */
export function PortfolioNumbers({ counts, className }: { counts: PortfolioCounts; className?: string }) {
  const parts: Array<[number, string, string]> = [
    [counts.confirmed, 'подтверждено', 'text-ds-good'],
    [counts.active, 'в работе', 'text-ds-ink'],
    [counts.suggested, 'ждёт решения', 'text-ds-ink'],
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
  return <li className={cn('flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5', primary && !calm && 'bg-ds-accent/[0.07]')}>
    <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full',
      calm ? 'bg-ds-panel2 text-ds-muted' : copy.tone === 'urgent' ? 'bg-ds-danger/15 text-ds-danger' : 'bg-ds-accent text-black')}>
      {calm ? <Clock className="h-4 w-4" /> : copy.tone === 'urgent' ? <span className="text-sm font-black">!</span> : <ArrowRight className="h-4 w-4" />}
    </span>
    {/* На телефоне текст занимает всю строку, кнопка переносится под него (ml-11 = иконка + отступ). */}
    <div className="min-w-0 flex-1 basis-[calc(100%-2.75rem)] sm:basis-0">
      <p className={cn('break-words text-sm font-bold', calm && 'font-semibold text-ds-muted')}>{copy.title}</p>
      <p className="mt-0.5 break-words text-xs text-ds-muted">{viewer === 'staff' && action.student_name ? `${action.student_name} · ` : ''}{copy.detail}</p>
    </div>
    {suggestion ? <div className="flex w-full flex-wrap gap-2 pl-11 sm:w-auto sm:pl-0">
      <AppButton size="sm" disabled={busy} onClick={() => add.mutate({ intakeId: suggestion.intake_id, existing: suggestion })}>Участвую</AppButton>
      <AppButton size="sm" variant="subtle" disabled={busy} onClick={() => decline.mutate(suggestion)}>Не интересно</AppButton>
      <Link to={participationPath(base, action)} className="self-center px-1 text-sm font-semibold underline underline-offset-4">Подробнее</Link>
    </div> : copy.cta
      ? <Link to={participationPath(base, action)} className={cn('ml-11 inline-flex shrink-0 items-center rounded-ctl px-4 py-2 text-sm font-bold transition sm:ml-0',
          primary ? 'bg-ds-accent text-black hover:brightness-95' : 'border border-ds-line hover:border-ds-muted2')}>{copy.cta}</Link>
      : <Link to={participationPath(base, action)} className="ml-11 shrink-0 text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink sm:ml-0">Открыть</Link>}
  </li>
}

/** Список «Сейчас»: первое действие выделено, ожидание ментора — спокойным цветом. */
export function NowList({ actions, viewer, plan, limit = 5, empty }: { actions: PortfolioAction[]; viewer: Viewer; plan?: Participation[]; limit?: number; empty: ReactNode }) {
  const [all, setAll] = useState(false)
  if (!actions.length) return <div className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">{empty}</div>
  const shown = all ? actions : actions.slice(0, limit)
  return <div className="overflow-hidden rounded-card border border-ds-line bg-ds-panel">
    <ul className="divide-y divide-ds-line">
      {shown.map((action, i) => <ActionItem key={`${action.kind}:${action.participation_id}`} action={action} viewer={viewer} plan={plan} primary={i === 0} />)}
    </ul>
    {actions.length > limit && <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-ds-line px-5 py-2.5 text-left text-xs font-bold text-ds-muted hover:text-ds-ink">
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

/** Что ментор советует усилить. У сотрудника редактируется на месте. */
export function FocusNote({ focus, studentId, editable = false }: { focus: PortfolioFocus | null; studentId?: string; editable?: boolean }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(focus?.text ?? '')
  const save = useMutation({
    mutationFn: () => activitiesApi.setFocus(studentId!, text),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['activities'] }); setEditing(false) },
  })
  if (!focus && !editable) return null
  if (editing) return <div className="space-y-2 rounded-card border border-ds-accent-dim bg-ds-panel p-4">
    <label htmlFor="portfolio-focus" className="text-sm font-bold">Что усилить в портфолио</label>
    <Textarea id="portfolio-focus" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Например: не хватает стажировки — летом попробовать IT-стажировку" />
    <p className="text-xs text-ds-muted">Ученик увидит это вверху своего портфолио и получит уведомление.</p>
    <div className="flex flex-wrap gap-2">
      <AppButton size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</AppButton>
      <AppButton size="sm" variant="subtle" onClick={() => { setText(focus?.text ?? ''); setEditing(false) }}>Отмена</AppButton>
    </div>
    {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
  </div>
  return <section aria-label="Ментор советует усилить" className="rounded-card border border-ds-accent-dim bg-ds-accent/[0.07] p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <MessageSquareQuote className="mt-0.5 h-5 w-5 shrink-0 text-ds-accentText" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-bold uppercase tracking-caps text-ds-accentText">Ментор советует усилить</p>
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
