import { origin, progress } from './ActivityTables'
import type { Participation } from '@/api/activities'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { activitiesApi } from '@/api/activities'
import { AppCard, AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { StudentPlan } from './StudentPlan'
import { PortfolioSummaryCard } from './PortfolioSummaryCard'
import { useAuth } from '@/contexts/AuthContext'
import { intakeLabel, intakeWhen } from '@/lib/activityUi'
import { formatDate } from '@/lib/utils'

function StaffParticipationList({ items, onOpen }: { items: Participation[]; onOpen: (item: Participation) => void }) {
  const steps = (item: Participation) => item.steps?.total ? `${item.steps.done} из ${item.steps.total}${item.steps.pending ? ` · ${item.steps.pending} на проверке` : ''}${item.steps.returned ? ` · ${item.steps.returned} на правках` : ''}` : 'Нет шагов'
  const due = (item: Participation) => item.steps?.next?.due_date || item.personal_deadline || item.intake.deadline
  return <>
    <div className="hidden overflow-x-auto rounded-card border border-ds-line bg-ds-panel md:block"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-ds-panel2 text-xs text-ds-muted"><tr>{['Активность', 'Состояние', 'Прогресс', 'Ментор', 'Ближайший срок', ''].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t border-ds-line"><td className="max-w-xs px-4 py-4"><p className="break-words font-semibold">{item.activity.title}</p><p className="mt-1 text-xs text-ds-muted">{intakeLabel(item.intake)} · {origin(item)}</p>{item.status === 'completed' && <p className="mt-1 text-xs text-ds-muted">Сертификаты: {item.certificates_count ?? 0}</p>}</td><td className="px-4 py-4">{item.result_review_status === 'pending' ? 'Итог на проверке' : progress(item)}</td><td className="px-4 py-4 text-ds-muted">{steps(item)}</td><td className="px-4 py-4 text-ds-muted">{item.mentor_name || 'Не назначен'}</td><td className="px-4 py-4 text-ds-muted">{due(item) ? formatDate(due(item)!) : 'Без срока'}</td><td className="px-4 py-4"><AppButton size="sm" variant="subtle" onClick={() => onOpen(item)}>{item.status === 'completed' ? 'Результат' : item.result_review_status === 'pending' || item.steps?.pending ? 'Проверить' : 'Открыть'}</AppButton></td></tr>)}</tbody></table></div>
    <div className="space-y-3 md:hidden">{items.map(item => <article key={item.id} className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4"><h3 className="break-words font-bold">{item.activity.title}</h3><div className="flex flex-wrap gap-2 text-sm">{progress(item)}<span className="text-ds-muted">{steps(item)}</span></div><p className="text-xs text-ds-muted">{intakeWhen(item.intake)}</p><p className="text-xs text-ds-muted">Ментор: {item.mentor_name || 'Не назначен'}</p>{item.status === 'completed' && <p className="text-xs text-ds-muted">Сертификаты: {item.certificates_count ?? 0}</p>}<AppButton size="sm" variant="subtle" onClick={() => onOpen(item)}>Открыть участие</AppButton></article>)}</div>
  </>
}

export function ActivityPlan({ studentId, catalogPath }: { studentId?: string; catalogPath: string }) {
  const navigate = useNavigate()
  const open = (item: Participation) => navigate(`${studentId ? '/workspace' : '/portal'}/activities/participations/${item.id}`)
  const { can } = useAuth()
  const query = useQuery({ queryKey: ['activities', 'plan', studentId ?? 'mine'], queryFn: () => activitiesApi.plan(studentId) })
  const summary = useQuery({ queryKey: ['activities', 'summary', studentId ?? 'mine'], queryFn: () => activitiesApi.summary(studentId) })
  const items = query.data ?? []
  const archived = (item: Participation) => item.decision === 'not_interested' || item.status === 'cancelled'
  const groups = [
    { name: 'В работе', items: items.filter(i => !archived(i) && i.status !== 'completed' && i.decision === 'selected') },
    { name: 'Рекомендации', items: items.filter(i => !archived(i) && i.status !== 'completed' && i.decision === 'suggested') },
    { name: 'Пройдено', items: items.filter(i => !archived(i) && i.status === 'completed') },
  ]
  const failed = query.isError ? query : summary
  return <QueryState isLoading={query.isLoading || summary.isLoading} isError={query.isError || summary.isError} error={failed.error} onRetry={() => { query.refetch(); summary.refetch() }}>
    {!summary.data ? null : !studentId ? <StudentPlan items={items} summary={summary.data} catalogPath={catalogPath} /> : <div className="space-y-6 text-ds-ink"><PortfolioSummaryCard studentId={studentId} summary={summary.data} catalogPath={catalogPath} editable={can('portfolio', 'manage')} />{!items.length ? <AppCard className="py-10 text-center text-ds-ink"><Compass className="mx-auto mb-3 h-8 w-8 text-ds-muted" /><h3 className="text-lg font-bold">Активностей пока нет</h3><p className="mx-auto mt-2 max-w-md text-sm text-ds-muted">Подберите активность и соберите индивидуальные шаги ученика.</p><Link className="mt-5 inline-block font-semibold underline" to={catalogPath}>Подобрать активность</Link></AppCard> : <><div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-line pt-5"><h2 className="text-lg font-bold">Все активности <span className="text-ds-muted">· {items.length}</span></h2><Link className="font-semibold underline" to={catalogPath}>Добавить активность</Link></div>{groups.filter(g => g.items.length).map(g => <section key={g.name} className="space-y-3"><h2 className="text-lg font-bold">{g.name} <span className="text-ds-muted">· {g.items.length}</span></h2><StaffParticipationList items={g.items} onOpen={open} /></section>)}{!!items.filter(archived).length && <details className="rounded-card border border-ds-line p-4"><summary className="cursor-pointer font-semibold">Архив · {items.filter(archived).length}</summary><div className="mt-4"><StaffParticipationList items={items.filter(archived)} onOpen={open} /></div></details>}</>}</div>}
  </QueryState>
}
