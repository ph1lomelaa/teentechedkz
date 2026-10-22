import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, ChevronRight, Trophy } from 'lucide-react'
import type { Participation, PortfolioSummary } from '@/api/activities'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { EXPERIENCE_LABEL, nearestDue, planGroup } from '@/lib/activityUi'
import { ProgressSegments } from './ActivityParts'
import { PortfolioFiles } from './PortfolioFiles'
import { StatusTag } from './StatusTag'
import { ExperienceStrip, FocusNote, NowList, PanelTitle } from './PortfolioParts'

function rowState(item: Participation): { label: string; tone: 'neutral' | 'info' | 'danger' | 'good' } {
  const steps = item.steps
  if (item.result_review_status === 'pending') return { label: 'Итог на проверке', tone: 'info' }
  if (steps?.returned) return { label: 'Нужны правки', tone: 'danger' }
  if (steps?.overdue) return { label: 'Есть просрочка', tone: 'danger' }
  if (steps?.pending) return { label: 'На проверке', tone: 'info' }
  if (!steps?.total) return { label: 'Ментор готовит шаги', tone: 'neutral' }
  if (steps.done >= steps.total) return { label: 'Пора отправить итог', tone: 'good' }
  return { label: `${steps.done} из ${steps.total}`, tone: 'neutral' }
}

/** Строка активности в работе: тип, название, прогресс, следующий шаг и срок. */
export function ActivityRow({ item, base }: { item: Participation; base: '/portal' | '/workspace' }) {
  const state = rowState(item)
  const due = nearestDue(item)
  const next = item.steps?.next
  return <li>
    <Link to={`${base}/activities/participations/${item.id}`} className="group flex items-center gap-4 px-4 py-4 transition hover:bg-ds-panel2 sm:px-5">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-2xs font-bold uppercase tracking-caps text-ds-muted">{EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']}</p>
        <p className="break-words font-bold leading-snug">{item.activity.title}</p>
        <ProgressSegments steps={item.steps} className="max-w-xs" />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ds-muted">
          <StatusTag tone={state.tone}>{state.label}</StatusTag>
          {next && next.state !== 'pending' && <span className="min-w-0 break-words">Дальше: {next.title}</span>}
          {due && <span>· до {formatDeadline(due)}</span>}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-muted transition group-hover:translate-x-0.5" aria-hidden />
    </Link>
  </li>
}

function AchievementCard({ item }: { item: Participation }) {
  return <article className="flex min-w-0 flex-col gap-3 rounded-card border border-ds-line bg-ds-panel p-4">
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-ds-good/15 text-ds-good"><Trophy className="h-4 w-4" aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-2xs font-bold uppercase tracking-caps text-ds-muted">{EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']}</p>
        <h3 className="mt-0.5 break-words text-sm font-bold">{item.activity.title}</h3>
        <p className="mt-0.5 text-xs text-ds-muted">Итог подтверждён{item.result_reviewed_at ? ` ${formatDeadline(item.result_reviewed_at.slice(0, 10))}` : ''}</p>
      </div>
    </div>
    {item.result_text && <p className="line-clamp-3 break-words text-sm">{item.result_text}</p>}
    {item.result_documents_count ? <PortfolioFiles target={{ participation_id: item.id }} result editable={false} /> : <p className="text-xs text-ds-muted">Файла нет</p>}
  </article>
}

/** Полка: фокус от ментора сверху, под ним ячейки типов опыта. */
function Experience({ id, summary, pick, wide = false }: { id: string; summary: PortfolioSummary; pick: (key: string) => string; wide?: boolean }) {
  return <section aria-labelledby={id} className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4">
    <PanelTitle id={id}>Полка</PanelTitle>
    <FocusNote focus={summary.focus} />
    <ExperienceStrip tiles={summary.experience} pickPath={pick} wide={wide} />
  </section>
}

function Achievements({ results }: { results: Participation[] }) {
  return results.length
    ? <div className="grid gap-3 md:grid-cols-2">{results.map((item) => <AchievementCard key={item.id} item={item} />)}</div>
    : <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">Здесь появятся участия, итог которых подтвердил ментор.</p>
}

/**
 * Портфолио ученика. Компьютер: слева «Сейчас», участия, достижения, справа полка.
 * Телефон: «Сейчас» первым, чтобы главное действие было на первом экране,
 * затем полка, участия и свёрнутые достижения.
 */
export function StudentPlan({ items, summary, catalogPath }: { items: Participation[]; summary: PortfolioSummary; catalogPath: string }) {
  const active = items.filter((item) => planGroup(item) === 'active')
    .sort((a, b) => (nearestDue(a) ?? '9999').localeCompare(nearestDue(b) ?? '9999'))
  const results = items.filter((item) => planGroup(item) === 'results')
  const closed = items.filter((item) => planGroup(item) === 'closed')
  const pick = (key: string) => `${catalogPath}&type=${key}`
  return <div className="space-y-6">
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="portfolio-now" className="space-y-3">
          <PanelTitle id="portfolio-now">Сейчас</PanelTitle>
          <NowList actions={summary.actions} viewer="student" plan={items} empty={items.length
            ? <>Новых дел нет. <Link to={catalogPath} className="font-semibold text-ds-ink underline underline-offset-4">Подобрать активность</Link></>
            : <>Портфолио начинается с первой активности. <Link to={catalogPath} className="font-semibold text-ds-ink underline underline-offset-4">Открыть каталог</Link></>} />
        </section>

        <div className="lg:hidden"><Experience id="portfolio-experience-m" summary={summary} pick={pick} wide /></div>

        <section aria-labelledby="portfolio-active" className="space-y-3">
          <PanelTitle id="portfolio-active" hint={<Link to={catalogPath} className="inline-flex items-center gap-1 font-semibold underline underline-offset-4 hover:text-ds-ink">Каталог <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>}>
            Участия{active.length > 0 && <span className="font-semibold text-ds-muted"> · {active.length}</span>}
          </PanelTitle>
          {active.length
            ? <ul className="divide-y divide-ds-line overflow-hidden rounded-card border border-ds-line bg-ds-panel">{active.map((item) => <ActivityRow key={item.id} item={item} base="/portal" />)}</ul>
            : <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">Сейчас участий в работе нет.</p>}
        </section>

        <section aria-labelledby="portfolio-results" className="hidden space-y-3 lg:block">
          <PanelTitle id="portfolio-results">Достижения{results.length > 0 && <span className="font-semibold text-ds-muted"> · {results.length}</span>}</PanelTitle>
          <Achievements results={results} />
        </section>
        <details className="group rounded-card border border-ds-line bg-ds-panel px-5 py-4 lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold">
            <span>Достижения <span className="font-semibold text-ds-muted">· {results.length}</span></span>
            <ChevronDown className="h-4 w-4 text-ds-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3"><Achievements results={results} /></div>
        </details>

        {closed.length > 0 && <details className="group rounded-card border border-ds-line bg-ds-panel px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold">
            <span>Не участвую <span className="font-semibold text-ds-muted">· {closed.length}</span></span>
            <ChevronDown className="h-4 w-4 text-ds-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-3 space-y-2">
            {closed.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-ds-line pt-2 text-sm">
              <span className="min-w-0 break-words">{item.activity.title}</span>
              <Link className="text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink" to={`/portal/activities/participations/${item.id}`}>Открыть</Link>
            </li>)}
          </ul>
        </details>}
      </div>

      <aside className="hidden min-w-0 space-y-4 lg:sticky lg:top-6 lg:block">
        <Experience id="portfolio-experience" summary={summary} pick={pick} />
      </aside>
    </div>
  </div>
}
