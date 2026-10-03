import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Check, ChevronDown, Clock, Hourglass, MessageCircle, Trophy } from 'lucide-react'
import { activitiesApi, type Participation } from '@/api/activities'
import type { RoadmapTask } from '@/api/roadmap'
import { AppButton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { studentDueText } from '@/lib/studentDeadline'
import { intakeWhen, pickNextAction, planGroup } from '@/lib/activityUi'
import { DirectionBadge, Eyebrow, ProgressSegments } from './ActivityParts'
import { useAddToPlan, useDecline } from './useStudentActivities'

const CHAT_PATH = '/portal/chat'

function NextStepCard({ items, catalogPath }: { items: Participation[]; catalogPath: string }) {
  const navigate = useNavigate()
  const action = pickNextAction(items)
  let title: string
  let detail: string
  let buttons: ReactNode = null
  let tone: 'accent' | 'calm' = 'accent'
  if (action.kind === 'step') {
    const { step, item } = action
    title = step.title
    detail = step.state === 'returned'
      ? `${item.activity.title} · ментор вернул на правки — посмотрите комментарий`
      : `${item.activity.title} · ${studentDueText({ due_date: step.due_date }, false)}`
    buttons = <>
      <AppButton onClick={() => navigate(`/portal/tasks?task_id=${step.id}`)}>{step.state === 'returned' ? 'Исправить и отправить' : 'Отправить работу'}</AppButton>
      <Link to={CHAT_PATH} className="inline-flex items-center gap-2 rounded-ctl border border-ds-line px-5 py-3 text-sm font-bold text-ds-ink transition hover:border-ds-muted2"><MessageCircle className="h-4 w-4" aria-hidden />Задать вопрос</Link>
    </>
  } else if (action.kind === 'waiting') {
    tone = 'calm'
    title = 'Работа отправлена, ждём ответ ментора'
    detail = `«${action.item.steps?.next?.title}» · ${action.item.activity.title}. Ментор проверит и ответит в плане.`
  } else if (action.kind === 'plan') {
    tone = 'calm'
    title = 'Ментор составляет план'
    detail = `Шаги по активности «${action.item.activity.title}» появятся здесь.`
  } else {
    tone = 'calm'
    title = items.length ? 'Новых шагов нет' : 'План начинается с интереса'
    detail = items.length ? 'Можно подобрать следующую активность.' : 'Выберите активность в каталоге — здесь соберётся ваш личный план.'
    buttons = <Link to={catalogPath} className="inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Открыть каталог <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
  }
  return <section aria-labelledby="activity-next-step" className={cn('rounded-card border p-5 sm:p-6', tone === 'accent' ? 'border-ds-accent-dim bg-ds-accent/[0.07]' : 'border-ds-line bg-ds-panel')}>
    <p id="activity-next-step" className={cn('text-2xs font-bold uppercase tracking-caps', tone === 'accent' ? 'text-ds-accentText' : 'text-ds-muted')}>Следующий шаг</p>
    <h2 className="mt-2 break-words text-xl font-bold leading-snug sm:text-2xl">{title}</h2>
    <p className="mt-2 text-sm text-ds-muted">{detail}</p>
    {buttons && <div className="mt-5 flex flex-wrap items-center gap-3">{buttons}</div>}
  </section>
}

type StepView = 'done' | 'current' | 'pending' | 'returned' | 'future'

function stepView(task: RoadmapTask, currentId: string | undefined): StepView {
  if (task.status === 'done') return 'done'
  if (task.review_status === 'pending') return 'pending'
  if (task.review_status === 'returned') return 'returned'
  return task.id === currentId ? 'current' : 'future'
}

const STEP_ICON: Record<StepView, ReactNode> = {
  done: <Check className="h-3.5 w-3.5" aria-hidden />,
  pending: <Hourglass className="h-3.5 w-3.5" aria-hidden />,
  returned: <span aria-hidden className="text-xs font-black">!</span>,
  current: <span aria-hidden className="h-2 w-2 rounded-full bg-current" />,
  future: null,
}
const STEP_DOT: Record<StepView, string> = {
  done: 'bg-ds-good/15 text-ds-good',
  pending: 'bg-ds-info/15 text-ds-info',
  returned: 'bg-ds-danger/15 text-ds-danger',
  current: 'bg-ds-accent text-black',
  future: 'border border-ds-line',
}

function StepList({ item }: { item: Participation }) {
  const tasks = useQuery({ queryKey: ['activities', 'tasks', item.id], queryFn: () => activitiesApi.tasks(item.id) })
  if (tasks.isLoading) return <div className="mt-4 h-16 animate-pulse rounded-panel bg-ds-panel2" />
  if (tasks.isError) return <button type="button" className="mt-4 text-sm underline" onClick={() => tasks.refetch()}>Не удалось загрузить шаги · повторить</button>
  const currentId = item.steps?.next?.state === 'pending' ? undefined : item.steps?.next?.id
  return <ol className="mt-4 space-y-2.5">
    {tasks.data?.map((task) => {
      const view = stepView(task, currentId)
      const note = view === 'done' ? 'выполнено'
        : view === 'pending' ? 'на проверке'
        : view === 'returned' ? 'нужны правки'
        : task.due_date ? `до ${formatDeadline(task.due_date)}` : ''
      return <li key={task.id} className="flex items-start gap-3 text-sm">
        <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full', STEP_DOT[view])}>{STEP_ICON[view]}</span>
        <span className={cn('min-w-0 flex-1 break-words', view === 'done' && 'text-ds-muted line-through decoration-ds-muted2', view === 'current' && 'font-semibold', view === 'future' && 'text-ds-muted')}>{task.title}</span>
        {note && <span className={cn('shrink-0 text-xs', view === 'returned' ? 'text-ds-danger' : view === 'pending' ? 'text-ds-info' : 'text-ds-muted')}>{note}</span>}
      </li>
    })}
  </ol>
}

function ActiveCard({ item, onOpen }: { item: Participation; onOpen: (item: Participation) => void }) {
  const steps = item.steps
  return <article className="flex min-w-0 flex-col rounded-card border border-ds-line bg-ds-panel p-5">
    <div className="flex items-start justify-between gap-3">
      <DirectionBadge direction={item.activity.direction} kind={item.activity.kind} className="min-w-0" />
      {steps?.total ? <span className="shrink-0 text-sm font-bold">{steps.done} из {steps.total}</span> : null}
    </div>
    <h3 title={item.activity.title} className="mt-3 line-clamp-2 break-words text-lg font-bold leading-snug">{item.activity.title}</h3>
    {item.personal_deadline && <p className="mt-2 text-xs text-ds-muted">Личный срок: {formatDeadline(item.personal_deadline)}</p>}
    {steps?.total
      ? <><ProgressSegments steps={steps} className="mt-3" /><StepList item={item} /></>
      : <p className="mt-3 flex items-center gap-2 text-sm text-ds-muted"><Clock className="h-4 w-4 shrink-0" aria-hidden />Ментор составляет план — шаги появятся здесь.</p>}
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
      <p className="min-w-0 truncate text-xs text-ds-muted">{item.mentor_name ? `Ментор: ${item.mentor_name}` : 'Ментора назначит команда'}</p>
      <button type="button" onClick={() => onOpen(item)} className="text-sm font-bold underline underline-offset-4 hover:text-ds-accentText">Шаги и цель</button>
    </div>
  </article>
}

function SuggestedCard({ item, onDetails }: { item: Participation; onDetails: (item: Participation) => void }) {
  const add = useAddToPlan()
  const decline = useDecline()
  const busy = add.isPending || decline.isPending
  return <article className="flex min-w-0 flex-col rounded-card border border-ds-line bg-ds-panel p-5">
    <DirectionBadge direction={item.activity.direction} kind={item.activity.kind} />
    <h3 title={item.activity.title} className="mt-3 line-clamp-2 break-words text-base font-bold leading-snug">{item.activity.title}</h3>
    <p className="mt-1 text-xs text-ds-muted">{[item.selected_by_name && `от ${item.selected_by_name}`, intakeWhen(item.intake)].filter(Boolean).join(' · ')}</p>
    {item.personal_deadline && <p className="mt-2 text-xs text-ds-muted">Личный срок: {formatDeadline(item.personal_deadline)}</p>}
    {item.recommendation_note && <p className="mt-3 border-l-2 border-ds-accent-dim pl-3 text-sm italic">«{item.recommendation_note}»</p>}
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
      <AppButton size="sm" variant="subtle" disabled={busy} onClick={() => add.mutate({ intakeId: item.intake_id, existing: item })}>Добавить в план</AppButton>
      <AppButton size="sm" variant="subtle" disabled={busy} onClick={() => decline.mutate(item)}>Не интересно</AppButton>
      <button type="button" onClick={() => onDetails(item)} className="px-1 text-sm font-semibold underline underline-offset-4">Подробнее</button>
    </div>
  </article>
}

function ResultCard({ item }: { item: Participation }) {
  return <article className="flex min-w-0 items-start gap-3 rounded-card border border-ds-line bg-ds-panel p-4">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-ds-good/15 text-ds-good"><Trophy className="h-4 w-4" aria-hidden /></span>
    <div className="min-w-0">
      <h3 className="break-words text-sm font-bold">{item.activity.title}</h3>
      <p className="mt-0.5 text-xs text-ds-muted">Результат подтверждён ментором{item.steps?.total ? ` · ${item.steps.done} из ${item.steps.total} шагов` : ''}</p>
    </div>
  </article>
}

function Group({ id, title, count, hint, children }: { id: string; title: string; count?: number; hint?: string; children: ReactNode }) {
  return <section aria-labelledby={id} className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-base font-bold">{title}{count !== undefined && <span className="font-semibold text-ds-muted"> · {count}</span>}</h2>
      {hint && <p className="text-xs text-ds-muted">{hint}</p>}
    </div>
    {children}
  </section>
}

/** План ученика: одно следующее действие сверху, ниже — участия по группам. */
export function StudentPlan({ items, catalogPath, onOpen, onDetails }: {
  items: Participation[]; catalogPath: string; onOpen: (item: Participation) => void; onDetails: (item: Participation) => void
}) {
  const by = (group: ReturnType<typeof planGroup>) => items.filter((item) => planGroup(item) === group)
  const active = by('active'), suggested = by('decide'), results = by('results'), closed = by('closed')
  return <div className="space-y-8">
    <NextStepCard items={items} catalogPath={catalogPath} />
    {active.length > 0 && <Group id="plan-active" title="В работе" count={active.length}>
      <div className="grid gap-4 lg:grid-cols-2">{active.map((item) => <ActiveCard key={item.id} item={item} onOpen={onOpen} />)}</div>
    </Group>}
    {suggested.length > 0 && <Group id="plan-suggested" title="Предложено ментором" count={suggested.length} hint="Решите, участвуете ли вы">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{suggested.map((item) => <SuggestedCard key={item.id} item={item} onDetails={onDetails} />)}</div>
    </Group>}
    <Group id="plan-results" title="Мои результаты" count={results.length || undefined}>
      {results.length
        ? <div className="grid gap-3 md:grid-cols-2">{results.map((item) => <ResultCard key={item.id} item={item} />)}</div>
        : <div className="rounded-card border border-dashed border-ds-line px-5 py-6 text-center">
            <Eyebrow>Полка пока пустая</Eyebrow>
            <p className="mx-auto mt-2 max-w-md text-sm text-ds-muted">Здесь соберутся активности, результат которых подтвердил ментор: дипломы, проекты, сертификаты — всё, что пойдёт в портфолио.</p>
          </div>}
    </Group>
    {closed.length > 0 && <details className="group rounded-card border border-ds-line bg-ds-panel px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold">
        <span>Не участвую <span className="font-semibold text-ds-muted">· {closed.length}</span></span>
        <ChevronDown className="h-4 w-4 text-ds-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-3 space-y-2">
        {closed.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-ds-line pt-2 text-sm">
          <span className="min-w-0 break-words">{item.activity.title}</span>
          <button type="button" className="text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink" onClick={() => onDetails(item)}>Открыть</button>
        </li>)}
      </ul>
    </details>}
  </div>
}
