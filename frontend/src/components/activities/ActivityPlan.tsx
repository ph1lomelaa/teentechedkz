import type { ReactNode } from 'react'
import type { Participation } from '@/api/activities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { activitiesApi } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { StudentPlan } from './StudentPlan'
import { PortfolioSummaryCard } from './PortfolioSummaryCard'
import { StatusTag } from './StatusTag'
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

function StaffParticipationList({ items, onOpen, onWithdraw, busy }: { items: Participation[]; onOpen: (item: Participation) => void; onWithdraw: (item: Participation) => void; busy: boolean }) {
  const date = (item: Participation) => item.decision === 'suggested' ? item.decide_by : item.steps?.next?.due_date || item.personal_deadline || item.intake.deadline
  const actionCell = (item: Participation) => item.decision === 'suggested'
    ? <button type="button" disabled={busy} onClick={() => onWithdraw(item)} className="text-sm font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Отозвать</button>
    : <AppButton size="sm" variant="subtle" onClick={() => onOpen(item)}>План</AppButton>
  return <>
    <div className="hidden overflow-x-auto rounded-card border border-ds-line bg-ds-panel md:block"><table className="w-full min-w-[640px] text-left text-sm">
      <thead className="bg-ds-panel2 text-xs text-ds-muted"><tr>{['Участие', 'Где сейчас', 'Дата', ''].map(label => <th className="px-4 py-3 font-semibold" key={label}>{label}</th>)}</tr></thead>
      <tbody>{items.map(item => { const where = whereNow(item); const d = date(item); return <tr key={item.id} className="border-t border-ds-line">
        <td className="px-4 py-3"><button type="button" onClick={() => onOpen(item)} className="text-left font-bold hover:underline">{item.activity.title}</button><p className="text-xs text-ds-muted">{EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']}</p></td>
        <td className="px-4 py-3"><StatusTag tone={where.tone}>{where.label}</StatusTag></td>
        <td className={`px-4 py-3 ${item.steps?.next?.state === 'overdue' ? 'font-semibold text-ds-danger' : 'text-ds-muted'}`}>{d ? formatDue(d) : '—'}</td>
        <td className="px-4 py-3 text-right">{actionCell(item)}</td>
      </tr> })}</tbody>
    </table></div>
    <ul className="space-y-3 md:hidden">{items.map(item => { const where = whereNow(item); const d = date(item); return <li key={item.id} className="space-y-2 rounded-card border border-ds-line bg-ds-panel p-4">
      <button type="button" onClick={() => onOpen(item)} className="block text-left font-bold">{item.activity.title}</button>
      <p className="flex flex-wrap items-center gap-2 text-xs text-ds-muted"><StatusTag tone={where.tone}>{where.label}</StatusTag>{d && formatDue(d)}</p>
      <div>{actionCell(item)}</div>
    </li> })}</ul>
  </>
}

function Collapsed({ title, items, render }: { title: string; items: Participation[]; render: (item: Participation) => ReactNode }) {
  if (!items.length) return null
  return <details className="group rounded-card border border-ds-line bg-ds-panel px-5 py-3">
    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold">{title} <span className="font-semibold text-ds-muted">· {items.length}</span></summary>
    <ul className="mt-2 divide-y divide-ds-line text-sm">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">{render(item)}</li>)}</ul>
  </details>
}

export function ActivityPlan({ studentId, catalogPath }: { studentId?: string; catalogPath: string }) {
  const navigate = useNavigate()
  const open = (item: Participation) => navigate(`${studentId ? '/workspace' : '/portal'}/activities/participations/${item.id}`)
  const { can } = useAuth()
  const query = useQuery({ queryKey: ['activities', 'plan', studentId ?? 'mine'], queryFn: () => activitiesApi.plan(studentId) })
  const summary = useQuery({ queryKey: ['activities', 'summary', studentId ?? 'mine'], queryFn: () => activitiesApi.summary(studentId) })
  const items = query.data ?? []
  const archived = (item: Participation) => item.decision === 'not_interested' || item.status === 'cancelled'
  const client = useQueryClient()
  const withdraw = useMutation({ mutationFn: (item: Participation) => activitiesApi.editPlan(item.id, { status: 'cancelled' }, false), onSuccess: () => client.invalidateQueries({ queryKey: ['activities'] }) })
  const current = items.filter(i => !archived(i) && i.status !== 'completed')
  const achievements = items.filter(i => !archived(i) && i.status === 'completed')
  const declined = items.filter(archived)
  const failed = query.isError ? query : summary
  return <QueryState isLoading={query.isLoading || summary.isLoading} isError={query.isError || summary.isError} error={failed.error} onRetry={() => { query.refetch(); summary.refetch() }}>
    {!summary.data ? null : !studentId ? <StudentPlan items={items} summary={summary.data} catalogPath={catalogPath} /> : <div className="space-y-6 text-ds-ink"><PortfolioSummaryCard studentId={studentId} summary={summary.data} editable={can('portfolio', 'manage')} /><div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-bold">Участия <span className="text-ds-muted">· {current.length}</span></h2><Link className="text-sm font-semibold underline underline-offset-4" to={`/workspace/activities/pick?student=${studentId}`}>Подобрать активность</Link></div>
      {current.length ? <StaffParticipationList items={current} onOpen={open} onWithdraw={(item) => withdraw.mutate(item)} busy={withdraw.isPending} />
        : <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted"><Compass className="mr-2 inline h-4 w-4" aria-hidden />Участий в работе нет.</p>}
    </div>
    <Collapsed title="Достижения" items={achievements} render={(item) => <><button type="button" onClick={() => open(item)} className="font-semibold hover:underline">{item.activity.title}</button><span className="text-xs text-ds-muted">{[item.result_reviewed_at ? formatDay(item.result_reviewed_at) : null, item.result_documents_count ? 'файл есть' : 'без файла'].filter(Boolean).join(' · ')}</span></>} />
    <Collapsed title="Не участвую" items={declined} render={(item) => <><button type="button" onClick={() => open(item)} className="hover:underline">{item.activity.title}</button>{item.decline_reason && <span className="text-xs text-ds-muted">{item.decline_reason}</span>}</>} />
  </div>}
  </QueryState>
}
