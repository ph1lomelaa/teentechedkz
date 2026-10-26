import { useQueryClient } from '@tanstack/react-query'
import { useWsEvent } from '@/lib/ws'
import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Plus } from 'lucide-react'
import { activitiesApi, type Activity, type ExperienceKey } from '@/api/activities'
import { isExperienceKey } from '@/lib/activityUi'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { UnderlineTabs } from '@/components/activities/ActivityParts'
import { StaffCatalog } from '@/components/activities/StaffCatalog'
import { ActivityDrawer } from '@/components/activities/ActivityDrawer'
import { ActivityImportDialog } from '@/components/activities/ActivityImportDialog'
import { ActivityPlan } from '@/components/activities/ActivityPlan'
import { MentorActivityGuide } from '@/components/activities/MentorActivityGuide'
import { StudentCatalog } from '@/components/activities/StudentCatalog'
import { MentorPortfolio } from '@/components/activities/MentorPortfolio'

export function ActivitiesPage() {
  const { user, can } = useAuth()
  const client = useQueryClient()
  useWsEvent('portfolio.updated', () => client.invalidateQueries({ queryKey: ['activities'] }))
  useWsEvent('roadmap.updated', () => client.invalidateQueries({ queryKey: ['activities'] }))
  const student = user?.role === 'student'
  const editable = !student && can('activity_catalog', 'manage')
  const [params, setParams] = useSearchParams()
  const requested = params.get('view')
  // Ученик: «Портфолио» | «Каталог». Сотрудник: «Активности» | «Ученики» | «Каталог».
  // Портфолио конкретного ученика живёт во вкладке его карточки.
  const view = requested === 'catalog' ? 'catalog' : student ? 'plan' : requested === 'students' && params.get('layout') !== 'board' ? 'students' : 'activities'
  const [opened, setOpened] = useState<Activity | 'new' | null>(null)
  const [drawerTab, setDrawerTab] = useState<'data' | 'preview' | 'recommend'>('data')
  const openActivity = (a: Activity | 'new', tab: 'data' | 'preview' | 'recommend' = 'data') => { setDrawerTab(tab); setOpened(a) }
  const [importing, setImporting] = useState(false)
  const catalog = useQuery({ queryKey: ['activities', 'catalog'], queryFn: activitiesApi.list, enabled: !student })
  const staffStudents = useQuery({ queryKey: ['activities', 'students'], queryFn: activitiesApi.staffStudents, enabled: !student && params.has('student_id') })
  const forStudentName = params.has('student_id') ? staffStudents.data?.find(s => s.id === params.get('student_id'))?.name ?? 'ученика' : undefined
  const navigateView = (next: string) => { const p = new URLSearchParams(params); p.set('view', next); if (next !== 'catalog') p.delete('student_id'); ['type', 'layout', 'p'].forEach((k) => p.delete(k)); setParams(p) }
  const recommendActivity = (id: string) => { const a = catalog.data?.find((c) => c.id === id); if (a) openActivity(a, 'recommend') }
  if (!student && requested === 'plan' && params.get('student_id')) return <Navigate replace to={`/workspace/students/${params.get('student_id')}#portfolio`} />
  return <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-6 px-4 py-6 text-ds-ink sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-extrabold tracking-tight">Portfolio UP</h1></div>
      {!student && <div className="flex shrink-0 items-center gap-2">{editable && view === 'catalog' && <AppButton onClick={() => openActivity('new')}><Plus className="h-4 w-4" /><span className="hidden sm:inline">Новая активность</span><span className="sm:hidden">Новая</span></AppButton>}{user?.role === 'admin' && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button aria-label="Другие действия" className="rounded-ctl border border-ds-line p-3"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 rounded-panel border border-ds-line bg-ds-panel p-1 text-sm text-ds-ink shadow-lg"><DropdownMenu.Item onSelect={() => setImporting(true)} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[highlighted]:bg-ds-panel2">Импорт Excel</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}</div>}
    </header>
    {!student && <MentorActivityGuide />}
    <UnderlineTabs label="Portfolio UP" value={view} onChange={navigateView} tabs={student ? [{ value: 'plan', label: 'Портфолио' }, { value: 'catalog', label: 'Каталог' }] : [{ value: 'activities', label: 'Активности' }, { value: 'students', label: 'Ученики' }, { value: 'catalog', label: <>Каталог <span className="text-ds-muted">{catalog.data?.length ?? ''}</span></> }]} />
    {student ? view === 'catalog' ? <StudentCatalog /> : <ActivityPlan catalogPath="?view=catalog" /> : view !== 'catalog' ? <MentorPortfolio view={view === 'students' ? 'students' : 'activities'} onAddStudent={editable || can('portfolio', 'manage') ? recommendActivity : undefined} /> : <QueryState isLoading={catalog.isLoading} isError={catalog.isError} error={catalog.error} onRetry={() => catalog.refetch()}><StaffCatalog catalog={catalog.data ?? []} editable={editable} onOpen={openActivity} onPreview={a => openActivity(a, 'preview')} onRecommend={a => openActivity(a, 'recommend')} onCreate={() => openActivity('new')} forStudent={forStudentName} /></QueryState>}
    {opened && <ActivityDrawer key={opened === 'new' ? 'new' : opened.id} activity={opened === 'new' ? null : opened} catalog={catalog.data ?? []} editable={editable} initialTab={drawerTab} initialStudent={params.get('student_id') ?? undefined} presetType={isExperienceKey(params.get('type')) ? params.get('type') as ExperienceKey : undefined} onClose={() => setOpened(null)} />}
    {importing && <ActivityImportDialog onClose={() => setImporting(false)} />}
  </div>
}
