import { useQueryClient } from '@tanstack/react-query'
import { useWsEvent } from '@/lib/ws'
import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Plus } from 'lucide-react'
import { activitiesApi, type Activity, type ExperienceKey } from '@/api/activities'
import { isExperienceKey } from '@/lib/activityUi'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { UnderlineTabs, Eyebrow } from '@/components/activities/ActivityParts'
import { StaffCatalog } from '@/components/activities/StaffCatalog'
import { ParticipationBoard } from '@/components/activities/ParticipationBoard'
import { ActivityDrawer } from '@/components/activities/ActivityDrawer'
import { ActivityImportDialog } from '@/components/activities/ActivityImportDialog'
import { ActivityPlan } from '@/components/activities/ActivityPlan'
import { MentorActivityGuide } from '@/components/activities/MentorActivityGuide'
import { StudentCatalog } from '@/components/activities/StudentCatalog'
import { StudentsOverview } from '@/components/activities/StudentsOverview'

/** Чьё портфолио открыто и переход в карточку — ментор не теряет контекст ученика. */
function StaffPlanHeader({ studentId }: { studentId: string }) {
  const { pathname } = useLocation()
  const students = useQuery({ queryKey: ['activities', 'students'], queryFn: activitiesApi.staffStudents })
  const name = students.data?.find(s => s.id === studentId)?.name
  const card = pathname.startsWith('/workspace') ? `/workspace/students/${studentId}#portfolio` : `/students/${studentId}#portfolio`
  return <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-2xl font-bold">{name ?? 'Ученик'}</h2><Link to={card} className="text-sm font-semibold underline underline-offset-4">Карточка ученика</Link></div>
}

export function ActivitiesPage() {
  const { user, can } = useAuth()
  const client = useQueryClient()
  useWsEvent('portfolio.updated', () => client.invalidateQueries({ queryKey: ['activities'] }))
  useWsEvent('roadmap.updated', () => client.invalidateQueries({ queryKey: ['activities'] }))
  const student = user?.role === 'student'
  const editable = !student && can('activity_catalog', 'manage')
  const [params, setParams] = useSearchParams()
  const requested = params.get('view')
  // Ученик: «Портфолио» | «Каталог». Сотрудник: «Ученики» (по умолчанию) |
  // «Проверка и действия» | «Каталог», и «Портфолио ученика» при student_id.
  const view = requested === 'catalog' ? 'catalog' : student ? 'plan'
    : requested === 'plan' && params.has('student_id') ? 'plan'
    : requested === 'overview' ? 'overview' : 'students'
  const [opened, setOpened] = useState<Activity | 'new' | null>(null)
  const [drawerTab, setDrawerTab] = useState<'data' | 'preview' | 'recommend'>('data')
  const openActivity = (a: Activity | 'new', tab: 'data' | 'preview' | 'recommend' = 'data') => { setDrawerTab(tab); setOpened(a) }
  const [importing, setImporting] = useState(false)
  const catalog = useQuery({ queryKey: ['activities', 'catalog'], queryFn: activitiesApi.list, enabled: !student })
  const summary = useQuery({ queryKey: ['activities', 'board-summary', params.get('student_id') ?? undefined], queryFn: () => activitiesApi.overview({ limit: 1, ...(params.has('student_id') ? { student_id: params.get('student_id')! } : {}) }), enabled: !student })
  const staffStudents = useQuery({ queryKey: ['activities', 'students'], queryFn: activitiesApi.staffStudents, enabled: !student && params.has('student_id') })
  const forStudentName = params.has('student_id') ? staffStudents.data?.find(s => s.id === params.get('student_id'))?.name ?? 'ученика' : undefined
  const navigateView = (next: string) => { const p = new URLSearchParams(params); p.set('view', next); if (next === 'students') p.delete('student_id'); p.delete('type'); setParams(p) }
  return <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-6 px-4 py-6 text-ds-ink sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Eyebrow>Portfolio UP</Eyebrow><h1 className="mt-1 text-3xl font-extrabold tracking-tight">{student ? 'Моё портфолио' : 'Активности'}</h1>{student && <p className="mt-2 text-sm text-ds-muted">Что сделать сейчас, что уже есть и что стоит усилить</p>}</div>
      {!student && <div className="flex shrink-0 items-center gap-2">{editable && <AppButton onClick={() => openActivity('new')}><Plus className="h-4 w-4" /><span className="hidden sm:inline">Новая активность</span><span className="sm:hidden">Новая</span></AppButton>}{user?.role === 'admin' && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button aria-label="Другие действия" className="rounded-ctl border border-ds-line p-3"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 rounded-panel border border-ds-line bg-ds-panel p-1 text-sm text-ds-ink shadow-lg"><DropdownMenu.Item onSelect={() => setImporting(true)} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[highlighted]:bg-ds-panel2">Импорт Excel</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}</div>}
    </header>
    {!student && <MentorActivityGuide />}
    <UnderlineTabs label="Активности" value={view} onChange={navigateView} tabs={student ? [{ value: 'plan', label: 'Портфолио' }, { value: 'catalog', label: 'Каталог' }] : [{ value: 'students', label: 'Ученики' }, { value: 'overview', label: <>Проверка и действия{!!summary.data?.counts.waiting && <span className="rounded-pill bg-ds-info/15 px-2 py-0.5 text-xs text-ds-info">{summary.data.counts.waiting} ждут</span>}</> }, { value: 'catalog', label: <>Каталог <span className="text-ds-muted">{catalog.data?.length ?? ''}</span></> }, ...(view === 'plan' ? [{ value: 'plan', label: 'Портфолио ученика' }] : [])]} />
    {student ? view === 'catalog' ? <StudentCatalog /> : <ActivityPlan catalogPath="?view=catalog" /> : view === 'students' ? <StudentsOverview /> : view === 'overview' ? <ParticipationBoard studentId={params.get('student_id') ?? undefined} /> : view === 'plan' ? <div className="space-y-5"><StaffPlanHeader studentId={params.get('student_id')!} /><ActivityPlan studentId={params.get('student_id')!} catalogPath={`?view=catalog&student_id=${params.get('student_id')}`} /></div> : <QueryState isLoading={catalog.isLoading} isError={catalog.isError} error={catalog.error} onRetry={() => catalog.refetch()}><StaffCatalog catalog={catalog.data ?? []} editable={editable} onOpen={openActivity} onPreview={a => openActivity(a, 'preview')} onRecommend={a => openActivity(a, 'recommend')} onCreate={() => openActivity('new')} forStudent={forStudentName} /></QueryState>}
    {opened && <ActivityDrawer key={opened === 'new' ? 'new' : opened.id} activity={opened === 'new' ? null : opened} catalog={catalog.data ?? []} editable={editable} initialTab={drawerTab} initialStudent={params.get('student_id') ?? undefined} presetType={isExperienceKey(params.get('type')) ? params.get('type') as ExperienceKey : undefined} onClose={() => setOpened(null)} />}
    {importing && <ActivityImportDialog onClose={() => setImporting(false)} />}
  </div>
}
