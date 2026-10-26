import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { workspaceApi, WorkspaceRoadmapTask } from '@/api/workspace'
import { roadmapApi } from '@/api/roadmap'
import { activitiesApi, type Participation } from '@/api/activities'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { useWsEvent } from '@/lib/ws'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AppButton, EmptyState, PageHeader, Pill } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryError } from '@/components/shared/QueryState'
import { FilterBar } from '@/components/activities/ActivityParts'
import { PortfolioFiles } from '@/components/activities/PortfolioFiles'
import { SubmissionView } from '@/components/activities/shared/SubmissionView'
import { EXPERIENCE_LABEL, formatDay, formatDue, formatPast } from '@/lib/portfolio/dictionary'
import { getErrorMessage } from '@/lib/errorMessage'

// Одна очередь «Проверка»: шаги Roadmap, шаги Portfolio UP и итоги участий.
// Список слева, выбранный пункт справа; ?item=<id> открывает пункт сразу.

const DAY_MS = 24 * 60 * 60 * 1000
const httpStatus = (err: unknown) => (err as { response?: { status?: number } })?.response?.status

type Item =
  | { key: string; kind: 'step'; source: 'roadmap' | 'portfolio'; student: string; title: string; context: string; since: string | null; task: WorkspaceRoadmapTask }
  | { key: string; kind: 'result'; source: 'portfolio'; student: string; title: string; context: string; since: string | null; participation: Participation }

type Filter = 'all' | 'steps' | 'results' | 'roadmap' | 'portfolio'
const FILTERS: Array<{ value: Filter; label: string; match: (item: Item) => boolean }> = [
  { value: 'all', label: 'Все', match: () => true },
  { value: 'steps', label: 'Шаги', match: (i) => i.kind === 'step' },
  { value: 'results', label: 'Итоги', match: (i) => i.kind === 'result' },
  { value: 'roadmap', label: 'Roadmap', match: (i) => i.source === 'roadmap' },
  { value: 'portfolio', label: 'Portfolio UP', match: (i) => i.source === 'portfolio' },
]

const stale = (since: string | null) => Boolean(since && Date.now() - new Date(since).getTime() > DAY_MS)

/** Решение по пункту: «Принять» или «Вернуть с комментарием» с обязательным полем. */
function Decision({ acceptLabel, busy, onAccept, onReturn, planPath }: { acceptLabel: string; busy: boolean; onAccept: () => void; onReturn: (comment: string) => void; planPath: string }) {
  const [returning, setReturning] = useState(false)
  const [comment, setComment] = useState('')
  return <div className="space-y-3 border-t border-w-line pt-4">
    {returning && <label className="block text-sm font-semibold">Что исправить<Textarea className="mt-2" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Напишите, что именно поправить" /></label>}
    <div className="flex flex-wrap items-center gap-2">
      {returning
        ? <><AppButton colorPrefix="w" size="sm" disabled={!comment.trim() || busy} onClick={() => onReturn(comment.trim())}>Отправить комментарий</AppButton>
            <AppButton colorPrefix="w" size="sm" variant="subtle" onClick={() => setReturning(false)}>Отмена</AppButton></>
        : <><AppButton colorPrefix="w" size="sm" disabled={busy} onClick={onAccept}>{acceptLabel}</AppButton>
            <AppButton colorPrefix="w" size="sm" variant="subtle" onClick={() => setReturning(true)}>Вернуть с комментарием</AppButton></>}
      <Link to={planPath} className="ml-auto text-sm font-semibold underline underline-offset-4">Открыть план</Link>
    </div>
  </div>
}

function Facts({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    {rows.filter(([, v]) => v).map(([k, v]) => <React.Fragment key={k}><dt className="text-w-muted">{k}</dt><dd className="font-semibold">{v}</dd></React.Fragment>)}
  </dl>
}

/** Шаг Portfolio UP: что прислано, что сдать, чеклист, дальше у ученика. */
function PortfolioStepCard({ task, onDone }: { task: WorkspaceRoadmapTask; onDone: () => void }) {
  const pid = task.activity_participation_id!
  const steps = useQuery({ queryKey: ['activities', 'tasks', pid], queryFn: () => activitiesApi.tasks(pid) })
  const submissions = useQuery({ queryKey: ['activities', 'submissions', pid], queryFn: () => activitiesApi.submissions(pid) })
  const full = steps.data?.find((t) => t.id === task.id)
  const index = steps.data ? steps.data.findIndex((t) => t.id === task.id) : -1
  const next = steps.data?.slice(index + 1).find((t) => t.status !== 'done')
  const current = submissions.data?.[task.id]?.find((s) => s.verdict === 'pending')
  const review = useMutation({
    mutationFn: ({ action, comment }: { action: 'approve' | 'return'; comment?: string }) => roadmapApi.reviewTask(task.id, comment ? { action, comment } : { action }),
    onSuccess: (_r, vars) => { toast({ title: vars.action === 'approve' ? 'Шаг принят' : 'Шаг возвращён ученику' }); onDone() },
    onError: (err) => { toast({ title: httpStatus(err) === 409 ? 'Шаг уже разобран' : getErrorMessage(err), variant: 'destructive' }); onDone() },
  })
  return <>
    <Facts rows={[
      ['Шаг', index >= 0 && steps.data ? `${index + 1} из ${steps.data.length}` : null],
      ['Срок', task.due_date ? `${formatDay(task.due_date)}, ${formatDue(task.due_date)}` : null],
      ['Отправлено', task.completed_at ? formatPast(task.completed_at) : null],
    ]} />
    {current ? <SubmissionView submission={current} title="Ученик прислал" />
      : <section className="space-y-2"><h3 className="text-sm font-semibold">Что прислал ученик</h3>{full?.result_text && <p className="whitespace-pre-wrap text-sm">{full.result_text}</p>}<PortfolioFiles target={{ task_id: task.id }} editable={false} /></section>}
    {full?.expected_result && <div className="rounded-ctl bg-w-panel2 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-w-muted">Что сдать</p><p className="whitespace-pre-wrap">{full.expected_result}</p></div>}
    {!!full?.subtasks.length && <section className="space-y-1.5"><h3 className="text-sm font-semibold">Чеклист ученика</h3>
      <ul className="space-y-1 text-sm">{full.subtasks.map((s) => <li key={s.id} className={s.is_done ? '' : 'text-w-muted'}>{s.is_done ? '☑' : '☐'} {s.title}</li>)}</ul></section>}
    {next && <p className="text-sm text-w-muted">Дальше у ученика: {next.title}{next.due_date ? `, ${formatDay(next.due_date)}` : ''}</p>}
    <Decision acceptLabel="Принять" busy={review.isPending} planPath={`/workspace/activities/participations/${pid}#step-${task.id}`}
      onAccept={() => review.mutate({ action: 'approve' })} onReturn={(comment) => review.mutate({ action: 'return', comment })} />
  </>
}

function RoadmapStepCard({ task, onDone }: { task: WorkspaceRoadmapTask; onDone: () => void }) {
  const review = useMutation({
    mutationFn: ({ action, comment }: { action: 'approve' | 'return'; comment?: string }) => roadmapApi.reviewTask(task.id, comment ? { action, comment } : { action }),
    onSuccess: (_r, vars) => { toast({ title: vars.action === 'approve' ? 'Задача принята' : 'Задача возвращена студенту' }); onDone() },
    onError: (err) => { toast({ title: httpStatus(err) === 409 ? 'Задача уже разобрана' : getErrorMessage(err), variant: 'destructive' }); onDone() },
  })
  return <>
    <Facts rows={[
      ['Этап', task.stage_name],
      ['Срок', task.due_date ? `${formatDay(task.due_date)}, ${formatDue(task.due_date)}` : null],
      ['Отправлено', task.completed_at ? formatPast(task.completed_at) : null],
      ['Подзадачи', task.subtasks_total ? `${task.subtasks_done} из ${task.subtasks_total}` : null],
    ]} />
    <Decision acceptLabel="Принять" busy={review.isPending} planPath={`/workspace/students/${task.student_id}#roadmap`}
      onAccept={() => review.mutate({ action: 'approve' })} onReturn={(comment) => review.mutate({ action: 'return', comment })} />
  </>
}

function ResultCard({ item, onDone }: { item: Participation; onDone: () => void }) {
  const review = useMutation({
    mutationFn: ({ action, comment }: { action: 'approve' | 'return'; comment?: string }) => activitiesApi.reviewResult(item.id, action, comment ?? ''),
    onSuccess: (_r, vars) => { toast({ title: vars.action === 'approve' ? 'Итог подтверждён' : 'Итог возвращён ученику' }); onDone() },
    onError: (err) => { toast({ title: getErrorMessage(err), variant: 'destructive' }); onDone() },
  })
  return <>
    <Facts rows={[
      ['Шаги', item.steps?.total ? `готово ${item.steps.done} из ${item.steps.total}` : null],
      ['Отправлено', item.result_submitted_at ? formatPast(item.result_submitted_at) : null],
    ]} />
    <section className="space-y-2"><h3 className="text-sm font-semibold">Что прислал ученик</h3>
      {item.result_text && <p className="whitespace-pre-wrap text-sm">{item.result_text}</p>}
      <PortfolioFiles target={{ participation_id: item.id }} result editable={false} /></section>
    <Decision acceptLabel="Подтвердить итог" busy={review.isPending} planPath={`/workspace/activities/participations/${item.id}#result`}
      onAccept={() => review.mutate({ action: 'approve' })} onReturn={(comment) => review.mutate({ action: 'return', comment })} />
  </>
}

export const WorkspaceReviewPage: React.FC = () => {
  const qc = useQueryClient()
  const { params, isPreview, mentorId } = useWorkspaceScope()
  const { can } = useAuth()
  const [search, setSearch] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('all')
  const results = useQuery({
    queryKey: ['activities', 'review-results', mentorId ?? 'mine'],
    queryFn: () => activitiesApi.overview({ view: 'waiting', limit: 200, ...(mentorId ? { mentor_id: mentorId } : {}) }),
    enabled: can('portfolio', 'manage'),
  })
  const { data: queueData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'review-queue', params],
    queryFn: () => workspaceApi.roadmapTasks({ review_status: 'pending', ...params }),
  })
  const { data: resolvedData } = useQuery({
    queryKey: ['workspace', 'review-resolved', params],
    queryFn: () => workspaceApi.roadmapTasks({ review_status: 'approved,returned', ...params }),
  })
  const refresh = () => ['workspace', 'activities'].forEach((key) => qc.invalidateQueries({ queryKey: [key] }))
  useWsEvent('task.review_requested', refresh)
  useWsEvent('roadmap.updated', refresh)
  useWsEvent('portfolio.updated', refresh)

  const items = useMemo<Item[]>(() => {
    const steps: Item[] = (queueData?.items ?? []).map((task) => ({
      key: task.id, kind: 'step', source: task.activity_participation_id ? 'portfolio' : 'roadmap', student: task.student_name,
      title: task.title, context: task.activity_participation_id ? `Portfolio UP · ${task.stage_name}` : `Roadmap · ${task.stage_name}`, since: task.completed_at, task,
    }))
    const finals: Item[] = (results.data?.items ?? []).filter((p) => p.result_review_status === 'pending').map((p) => ({
      key: `result-${p.id}`, kind: 'result', source: 'portfolio', student: p.student_name ?? 'Ученик',
      title: `Итог: ${p.activity.title}`, context: `Portfolio UP · ${EXPERIENCE_LABEL[p.activity.experience_type ?? 'other']}`, since: p.result_submitted_at ?? null, participation: p,
    }))
    return [...steps, ...finals].sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))
  }, [queueData, results.data])
  const shown = items.filter(FILTERS.find((f) => f.value === filter)!.match)
  const selectedKey = search.get('item')
  const selected = shown.find((i) => i.key === selectedKey) ?? (selectedKey ? undefined : shown[0])
  const select = (key: string) => { const p = new URLSearchParams(search); p.set('item', key); setSearch(p, { replace: true }) }
  const today = new Date().toDateString()
  const reviewedToday = (resolvedData?.items ?? []).filter((t) => t.reviewed_at && new Date(t.reviewed_at).toDateString() === today).length

  return <div className="fade-in">
    <PageHeader colorPrefix="w" eyebrow={isPreview ? 'Preview кабинета ментора' : undefined} title="Проверка"
      action={<Pill colorPrefix="w" tone="neutral" className="bg-w-good/15 text-w-good">Проверено сегодня: {reviewedToday}</Pill>} />
    {isError ? <QueryError colorPrefix="w" error={error} onRetry={refetch} /> : isLoading ? <p className="text-sm text-w-muted">Загрузка…</p> : <div className="space-y-4">
      <FilterBar label="Фильтр проверки" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: f.value === 'all' ? items.length : items.filter(f.match).length }))} />
      {!shown.length ? <EmptyState colorPrefix="w" icon={<ClipboardCheck className="h-6 w-6" />} title="Всё проверено" description="Новые отправки учеников появятся здесь." />
        : <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ul className={cn('divide-y divide-w-line overflow-hidden rounded-card border border-w-line bg-w-panel', selectedKey && 'hidden lg:block')}>
            {shown.map((item) => <li key={item.key}>
              <button type="button" onClick={() => select(item.key)} aria-current={selected?.key === item.key}
                className={cn('block w-full px-4 py-3 text-left transition hover:bg-w-panel2', selected?.key === item.key && 'bg-w-panel2')}>
                <span className="block text-xs font-semibold text-w-muted">{item.student}</span>
                <span className="block break-words text-sm font-bold">{item.title}</span>
                <span className="block text-xs text-w-muted">{item.context}{item.since ? ` · ${formatPast(item.since)}` : ''}</span>
                {stale(item.since) && <span className="mt-1 block text-2xs font-bold text-w-accentText">в очереди больше суток</span>}
              </button>
            </li>)}
          </ul>
          {selected ? <section key={selected.key} className="space-y-4 rounded-card border border-w-line bg-w-panel p-4 sm:p-5">
            {selectedKey && <button type="button" className="text-sm font-semibold text-w-muted lg:hidden" onClick={() => { const p = new URLSearchParams(search); p.delete('item'); setSearch(p, { replace: true }) }}>← К списку</button>}
            <header>
              <p className="text-xs text-w-muted"><Link to={`/workspace/students/${selected.kind === 'step' ? selected.task.student_id : selected.participation.student_id}#portfolio`} className="font-semibold hover:underline">{selected.student}</Link> · {selected.context}</p>
              <h2 className="mt-1 break-words text-lg font-bold">{selected.title}</h2>
            </header>
            {selected.kind === 'result' ? <ResultCard item={selected.participation} onDone={refresh} />
              : selected.source === 'portfolio' ? <PortfolioStepCard task={selected.task} onDone={refresh} />
              : <RoadmapStepCard task={selected.task} onDone={refresh} />}
          </section> : <p className="rounded-card border border-dashed border-w-line p-6 text-sm text-w-muted">Этот пункт уже разобран. Выберите другой в списке.</p>}
        </div>}
    </div>}
  </div>
}
