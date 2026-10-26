import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, ChevronRight, Trophy } from 'lucide-react'
import type { Participation, PortfolioSummary } from '@/api/activities'
import { cn } from '@/lib/utils'
import { PARTICIPATION_STAGE, STEP_STATUS, formatDay, formatDue, type StatusTone } from '@/lib/portfolio/dictionary'
import { nearestDue, planGroup } from '@/lib/activityUi'
import { ProgressSegments } from './ActivityParts'
import { PortfolioFiles } from './PortfolioFiles'
import { StatusTag } from './StatusTag'
import { NowList, PanelTitle } from './PortfolioParts'

/** Чип по следующему шагу; шаг на проверке не делает всё участие «на проверке». */
function rowState(item: Participation): { label: string; tone: StatusTone } | null {
  if (item.result_review_status === 'pending') return PARTICIPATION_STAGE.result_review
  const next = item.steps?.next
  if (!item.steps?.total) return { label: 'Нужен план', tone: 'neutral' }
  if (!next) return { label: 'Пора отправить итог', tone: 'neutral' }
  if (next.state === 'returned') return STEP_STATUS.returned
  if (next.state === 'pending') return STEP_STATUS.pending
  return null
}

/** «Шаг 2 из 3: Эссе, 26 окт.» или «Шаг 1 на проверке». */
function rowLine(item: Participation): { text: string; overdue: string | null } {
  const steps = item.steps
  const next = steps?.next
  if (!steps?.total) return { text: 'Ментор готовит шаги', overdue: null }
  if (!next) return { text: '', overdue: null }
  if (next.state === 'pending') return { text: `Шаг ${next.index || steps.done + 1} на проверке`, overdue: null }
  const date = next.due_date ? `, ${formatDay(next.due_date)}` : ''
  const lead = steps.pending ? `Шаг ${steps.done + 1} на проверке` : `Шаг ${next.index || steps.done + 1} из ${steps.total}: ${next.title}${date}`
  const late = next.state === 'overdue' && next.due_date ? formatDue(next.due_date) : null
  return { text: lead, overdue: late }
}

/** Строка участия: тип, название, сегменты (шаги + итог), чип и следующий шаг. */
export function ActivityRow({ item, base }: { item: Participation; base: '/portal' | '/workspace' }) {
  const state = rowState(item)
  const line = rowLine(item)
  return <li>
    <Link to={`${base}/activities/participations/${item.id}`} className="group flex items-center gap-4 px-4 py-4 transition hover:bg-ds-panel2 sm:px-5">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="break-words font-bold leading-snug">{item.activity.title}</p>
        <div className="flex max-w-xs items-center gap-1">
          <ProgressSegments steps={item.steps} className="flex-1" />
          {!!item.steps?.total && <span aria-hidden title="Итог" className={cn('h-1.5 w-6 rounded-full border border-dashed', item.result_review_status === 'pending' ? 'border-ds-info bg-ds-info/40' : 'border-ds-muted2')} />}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ds-muted">
          {state && <StatusTag tone={state.tone}>{state.label}</StatusTag>}
          <span className="min-w-0 break-words">{line.text}</span>
          {line.overdue && <span className="font-semibold text-ds-danger">{line.overdue}</span>}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-muted transition group-hover:translate-x-0.5" aria-hidden />
    </Link>
  </li>
}

/** Достижение строкой: название, «тип · дата · итог», справа файл или «+ Файл». */
function AchievementRow({ item }: { item: Participation }) {
  const meta = [item.result_reviewed_at ? formatDay(item.result_reviewed_at) : null, item.result_text].filter(Boolean).join(' · ')
  return <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
    <Trophy className="h-4 w-4 shrink-0 text-ds-good" aria-hidden />
    <Link to={`/portal/activities/participations/${item.id}`} className="min-w-0 flex-1 basis-48">
      <span className="block break-words text-sm font-bold hover:underline">{item.activity.title}</span>
      <span className="block truncate text-xs text-ds-muted" title={meta}>{meta}</span>
    </Link>
    <div className="shrink-0">
      {item.result_documents_count
        ? <PortfolioFiles target={{ participation_id: item.id }} result editable={false} />
        : <Link to={`/portal/activities/participations/${item.id}#result`} className="inline-flex items-center gap-1 rounded-ctl border border-ds-line px-3 py-1.5 text-xs font-bold hover:border-ds-muted2">+ Файл</Link>}
    </div>
  </li>
}

function Achievements({ results }: { results: Participation[] }) {
  return results.length
    ? <ul className="divide-y divide-ds-line overflow-hidden rounded-card border border-ds-line bg-ds-panel">{results.map((item) => <AchievementRow key={item.id} item={item} />)}</ul>
    : <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">Здесь появятся участия, итог которых подтвердил ментор.</p>
}

/** Портфолио ученика: «Сейчас», участия, достижения. На телефоне достижения свёрнуты. */
export function StudentPlan({ items, summary, catalogPath }: { items: Participation[]; summary: PortfolioSummary; catalogPath: string }) {
  const active = items.filter((item) => planGroup(item) === 'active')
    .sort((a, b) => (nearestDue(a) ?? '9999').localeCompare(nearestDue(b) ?? '9999'))
  const results = items.filter((item) => planGroup(item) === 'results')
  const closed = items.filter((item) => planGroup(item) === 'closed')
  return <div className="space-y-6">
    <div className="max-w-3xl">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="portfolio-now" className="space-y-3">
          <PanelTitle id="portfolio-now">Сейчас</PanelTitle>
          <NowList actions={summary.actions} viewer="student" plan={items} empty={items.length
            ? <>Новых дел нет. <Link to={catalogPath} className="font-semibold text-ds-ink underline underline-offset-4">Подобрать активность</Link></>
            : <>Портфолио начинается с первой активности. <Link to={catalogPath} className="font-semibold text-ds-ink underline underline-offset-4">Открыть каталог</Link></>} />
        </section>

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

    </div>
  </div>
}
