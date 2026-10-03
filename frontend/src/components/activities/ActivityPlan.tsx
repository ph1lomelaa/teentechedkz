import { origin, progress } from './ActivityTables'
import { useState } from 'react'
import { ParticipationPanel } from './ParticipationPanel'
import type { Participation } from '@/api/activities'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Compass } from 'lucide-react'
import { activitiesApi } from '@/api/activities'
import { AppCard, AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { StudentPlan } from './StudentPlan'
import { intakeLabel, intakeWhen } from '@/lib/activityUi'

export function ActivityPlan({ studentId, catalogPath }: { studentId?: string; catalogPath: string }) {
  const navigate = useNavigate()
  const [opened, setOpened] = useState<Participation | null>(null)
  const query = useQuery({ queryKey: ['activities', 'plan', studentId ?? 'mine'], queryFn: () => activitiesApi.plan(studentId) })
  return <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
    {opened && <ParticipationPanel item={opened} onClose={() => setOpened(null)} />}
    {!!studentId && !!query.data?.length && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-ds-ink"><p className="text-sm text-ds-muted">Активностей в плане: {query.data.length}</p><Link className="font-bold underline underline-offset-4" to={catalogPath}>Добавить активность</Link></div>}
    {!studentId ? <StudentPlan items={query.data ?? []} catalogPath={catalogPath} onOpen={setOpened} onDetails={item => navigate(`/portal/activities/${item.activity.id}`)} /> : !query.data?.length ? <AppCard className="py-10 text-center text-ds-ink">
      <Compass className="mx-auto mb-3 h-8 w-8 text-ds-muted" />
      <h3 className="text-lg font-bold">План начинается с интереса</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ds-muted">Выберите активность из каталога. Здесь будет собран личный план участия ученика.</p>
      <Link className="mt-5 inline-flex items-center gap-2 font-bold text-ds-ink underline underline-offset-4" to={catalogPath}>Подобрать активность <ArrowUpRight className="h-4 w-4" /></Link>
    </AppCard> : studentId ? <div className="overflow-x-auto rounded-2xl border border-ds-line bg-ds-panel text-ds-ink"><table className="w-full min-w-[750px] text-left text-sm"><thead className="text-xs text-ds-muted"><tr>{['Активность','Состояние','Шаги','Источник','Ментор',''].map(x=><th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody>{query.data.map(item=><tr key={item.id} className="border-t border-ds-line"><td className="px-4 py-4"><div className="font-bold">{item.activity.title}</div><p className="mt-1 text-ds-muted">{[intakeLabel(item.intake), intakeWhen(item.intake)].filter(Boolean).join(' · ')}</p>{item.goal && <p className="mt-2 text-sm">{item.goal}</p>}</td><td className="px-4 py-4">{progress(item)}</td><td className="px-4 py-4">{item.steps?.total ? <><div className="font-semibold">{item.steps.done} из {item.steps.total}</div>{(item.steps.returned > 0 || item.steps.pending > 0 || item.steps.overdue > 0) && <p className="mt-1 text-xs text-ds-muted">{[item.steps.pending && `на проверке: ${item.steps.pending}`, item.steps.returned && `на правках: ${item.steps.returned}`, item.steps.overdue && `просрочено: ${item.steps.overdue}`].filter(Boolean).join(' · ')}</p>}</> : <span className="text-ds-muted">Нет шагов</span>}</td><td className="px-4 py-4">{origin(item)}</td><td className="px-4 py-4">{item.mentor_name || 'Не назначен'}</td><td className="px-4 py-4"><AppButton variant="subtle" onClick={()=>setOpened(item)}>План и задачи</AppButton></td></tr>)}</tbody></table></div> : <StudentPlan items={query.data} catalogPath={catalogPath} onOpen={setOpened} onDetails={item => navigate(`/portal/activities/${item.activity.id}`)} />}
  </QueryState>
}
