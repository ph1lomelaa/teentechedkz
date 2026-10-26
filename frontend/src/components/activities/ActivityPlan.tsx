import { useEffect } from 'react'
import type { Participation } from '@/api/activities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, Compass, Plus } from 'lucide-react'
import { activitiesApi } from '@/api/activities'
import { QueryState } from '@/components/shared/QueryState'
import { StudentPlan } from './StudentPlan'
import { PortfolioSummaryCard } from './PortfolioSummaryCard'
import { StatusTag } from './StatusTag'
import { ParticipationPath } from './ParticipationPath'
import { ProgressSegments } from './ActivityParts'
import { useAuth } from '@/contexts/AuthContext'
import { EXPERIENCE_LABEL } from '@/lib/activityUi'
import { PARTICIPATION_STAGE, STEP_STATUS, formatDay, formatDue, participationStage, type StatusTone } from '@/lib/portfolio/dictionary'

/** «Где сейчас»: стадия участия и, для работы, состояние следующего шага. */
function whereNow(item: Participation): { label: string; tone: StatusTone } {
  const stage = participationStage(item)
  if (stage !== 'in_work') return PARTICIPATION_STAGE[stage]
  if (!item.steps?.total) return { label: 'Нужен план', tone: 'neutral' }
  if (item.steps.next?.state === 'pending') return STEP_STATUS.pending
  if (item.steps.next?.state === 'returned') return STEP_STATUS.returned
  if (item.steps.next?.state === 'overdue') return { label: 'Просрочен шаг', tone: 'danger' }
  return PARTICIPATION_STAGE.in_work
}

/** Активность ученика строкой, как этап Roadmap: раскрывается шагами, файлами и итогом. */
function ParticipationRow({ item, open, onToggle, onWithdraw, busy }: { item: Participation; open: boolean; onToggle: () => void; onWithdraw: (item: Participation) => void; busy: boolean }) {
  const where = whereNow(item)
  const d = item.decision === 'suggested' ? item.decide_by : item.steps?.next?.due_date || item.personal_deadline || item.intake.deadline
  const late = item.steps?.next?.state === 'overdue'
  return <li id={`participation-${item.id}`} className={`scroll-mt-6 rounded-card border bg-ds-panel ${open ? 'border-ds-muted2' : 'border-ds-line'}`}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 basis-64 items-center gap-3 text-left">
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-ds-muted transition ${open ? '' : '-rotate-90'}`} />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-bold">{item.activity.title}</span>
          <span className="block text-xs text-ds-muted">{item.intake.deadline ? `подача до ${formatDay(item.intake.deadline)}` : EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']}</span>
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-3 pl-7 text-xs sm:pl-0">
        {!!item.steps?.total && <span className="flex w-28 items-center gap-2"><ProgressSegments steps={item.steps} className="flex-1" /><span className="text-ds-muted">{item.steps.done}/{item.steps.total}</span></span>}
        <StatusTag tone={where.tone}>{where.label}</StatusTag>
        {d && <span className={late ? 'font-semibold text-ds-danger' : 'text-ds-muted'}>{formatDue(d)}</span>}
        {item.decision === 'suggested' && <button type="button" disabled={busy} onClick={() => onWithdraw(item)} className="font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Отозвать</button>}
      </div>
    </div>
    {open && <div className="border-t border-ds-line p-4 sm:p-5"><ParticipationPath participationId={item.id} embedded /></div>}
  </li>
}

/** Активности ученика для команды: в работе, достижения, отказы. Карточка ученика и список учеников показывают одно и то же. */
export function StudentActivities({ studentId, compact = false }: { studentId: string; compact?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  // Раскрытая активность живёт в ссылке (?p=), её можно переслать; якорь раздела карточки сохраняется.
  const opened = new URLSearchParams(location.search).get('p')
  const toggle = (item: Participation) => {
    const p = new URLSearchParams(location.search)
    if (opened === item.id) p.delete('p'); else p.set('p', item.id)
    navigate({ search: p.toString(), hash: location.hash }, { replace: true })
  }
  const { can } = useAuth()
  const query = useQuery({ queryKey: ['activities', 'plan', studentId], queryFn: () => activitiesApi.plan(studentId) })
  const items = query.data ?? []
  const archived = (item: Participation) => item.decision === 'not_interested' || item.status === 'cancelled'
  const client = useQueryClient()
  const withdraw = useMutation({ mutationFn: (item: Participation) => activitiesApi.editPlan(item.id, { status: 'cancelled' }, false), onSuccess: () => client.invalidateQueries({ queryKey: ['activities'] }) })
  const current = items.filter(i => !archived(i) && i.status !== 'completed')
  const achievements = items.filter(i => !archived(i) && i.status === 'completed')
  const declined = items.filter(archived)
  useEffect(() => {
    if (opened && query.data?.some(i => i.id === opened)) document.getElementById(`participation-${opened}`)?.scrollIntoView({ block: 'start' })
  }, [opened, query.data])
  const rows = (list: Participation[]) => <ul className="space-y-2">{list.map(item => <ParticipationRow key={item.id} item={item} open={opened === item.id} onToggle={() => toggle(item)} onWithdraw={(i) => withdraw.mutate(i)} busy={withdraw.isPending} />)}</ul>
  const heading = compact ? 'text-sm font-bold' : 'text-lg font-bold'
  return <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={heading}>Активности <span className="text-ds-muted">· {current.length}</span></h2>
          {can('portfolio', 'manage') && <Link to={`/workspace/activities/pick?student=${studentId}`} className="inline-flex items-center gap-1.5 rounded-ctl bg-ds-accent px-3 py-2 text-sm font-bold text-black hover:opacity-90"><Plus className="h-4 w-4" aria-hidden />Добавить активность</Link>}
        </div>
        {current.length ? rows(current)
          : <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted"><Compass className="mr-2 inline h-4 w-4" aria-hidden />Активностей в работе нет. Нажмите «Добавить активность», выберите из каталога и составьте шаги.</p>}
      </section>
      {!!achievements.length && <section className="space-y-3"><h2 className={heading}>Достижения <span className="text-ds-muted">· {achievements.length}</span></h2>{rows(achievements)}</section>}
      {!!declined.length && <details className="group space-y-3" open={declined.some(i => i.id === opened)}>
        <summary className="cursor-pointer list-none text-sm font-bold text-ds-muted hover:text-ds-ink">Не участвует · {declined.length}</summary>
        <div className="pt-3">{rows(declined)}</div>
      </details>}
    </div>
  </QueryState>
}

export function ActivityPlan({ studentId, catalogPath }: { studentId?: string; catalogPath: string }) {
  const { can } = useAuth()
  const query = useQuery({ queryKey: ['activities', 'plan', studentId ?? 'mine'], queryFn: () => activitiesApi.plan(studentId), enabled: !studentId })
  const summary = useQuery({ queryKey: ['activities', 'summary', studentId ?? 'mine'], queryFn: () => activitiesApi.summary(studentId) })
  const failed = query.isError ? query : summary
  return <QueryState isLoading={(!studentId && query.isLoading) || summary.isLoading} isError={query.isError || summary.isError} error={failed.error} onRetry={() => { query.refetch(); summary.refetch() }}>
    {!summary.data ? null : !studentId ? <StudentPlan items={query.data ?? []} summary={summary.data} catalogPath={catalogPath} /> : <div className="space-y-6 text-ds-ink">
      <StudentActivities studentId={studentId} />
      <PortfolioSummaryCard studentId={studentId} summary={summary.data} editable={can('portfolio', 'manage')} />
    </div>}
  </QueryState>
}
