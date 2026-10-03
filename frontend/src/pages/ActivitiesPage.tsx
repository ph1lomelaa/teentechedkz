import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Plus } from 'lucide-react'
import { activitiesApi, type Activity } from '@/api/activities'
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

export function ActivitiesPage() {
  const { user, can } = useAuth()
  const student = user?.role === 'student'
  const editable = !student && can('activity_catalog', 'manage')
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'catalog' ? 'catalog' : student ? 'plan' : params.get('view') === 'plan' && params.has('student_id') ? 'plan' : params.get('view') === 'overview' ? 'overview' : 'catalog'
  const [opened, setOpened] = useState<Activity | 'new' | null>(null)
  const [drawerTab, setDrawerTab] = useState<'data' | 'preview' | 'recommend'>('data')
  const openActivity = (a: Activity | 'new', tab: 'data' | 'preview' | 'recommend' = 'data') => { setDrawerTab(tab); setOpened(a) }
  const [importing, setImporting] = useState(false)
  const catalog = useQuery({ queryKey: ['activities', 'catalog'], queryFn: activitiesApi.list, enabled: !student })
  const summary = useQuery({ queryKey: ['activities', 'board-summary', params.get('student_id') ?? undefined], queryFn: () => activitiesApi.overview({ limit: 1, ...(params.has('student_id') ? { student_id: params.get('student_id')! } : {}) }), enabled: !student })
  const navigateView = (next: string) => { const p = new URLSearchParams(params); p.set('view', next); setParams(p) }
  return <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-6 px-4 py-6 text-ds-ink sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Eyebrow>Portfolio UP</Eyebrow><h1 className="mt-1 text-3xl font-extrabold tracking-tight">Активности</h1>{student && <p className="mt-2 text-sm text-ds-muted">Ваш опыт, проекты и следующие шаги</p>}</div>
      {!student && <div className="flex shrink-0 items-center gap-2">{editable && <AppButton onClick={() => openActivity('new')}><Plus className="h-4 w-4" /><span className="hidden sm:inline">Новая активность</span><span className="sm:hidden">Новая</span></AppButton>}{user?.role === 'admin' && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button aria-label="Другие действия" className="rounded-ctl border border-ds-line p-3"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 rounded-panel border border-ds-line bg-ds-panel p-1 text-sm text-ds-ink shadow-lg"><DropdownMenu.Item onSelect={() => setImporting(true)} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[highlighted]:bg-ds-panel2">Импорт Excel</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}</div>}
    </header>
    {!student && <MentorActivityGuide />}
    <UnderlineTabs label="Активности" value={view} onChange={navigateView} tabs={student ? [{ value: 'plan', label: 'Мой план' }, { value: 'catalog', label: 'Каталог' }] : [{ value: 'catalog', label: <>Каталог <span className="text-ds-muted">{catalog.data?.length ?? ''}</span></> }, { value: 'overview', label: <>Участия учеников{!!summary.data?.counts.waiting && <span className="rounded-pill bg-ds-info/15 px-2 py-0.5 text-xs text-ds-info">{summary.data.counts.waiting} ждут</span>}</> }, ...(view === 'plan' ? [{ value: 'plan', label: 'План ученика' }] : [])]} />
    {student ? view === 'catalog' ? <StudentCatalog /> : <ActivityPlan catalogPath="?view=catalog" /> : view === 'overview' ? <ParticipationBoard studentId={params.get('student_id') ?? undefined} /> : view === 'plan' ? <ActivityPlan studentId={params.get('student_id')!} catalogPath={`?view=catalog&student_id=${params.get('student_id')}`} /> : <QueryState isLoading={catalog.isLoading} isError={catalog.isError} error={catalog.error} onRetry={() => catalog.refetch()}><StaffCatalog catalog={catalog.data ?? []} editable={editable} onOpen={openActivity} onPreview={a => openActivity(a, 'preview')} onRecommend={a => openActivity(a, 'recommend')} /></QueryState>}
    {opened && <ActivityDrawer key={opened === 'new' ? 'new' : opened.id} activity={opened === 'new' ? null : opened} catalog={catalog.data ?? []} editable={editable} initialTab={drawerTab} initialStudent={params.get('student_id') ?? undefined} onClose={() => setOpened(null)} />}
    {importing && <ActivityImportDialog onClose={() => setImporting(false)} />}
  </div>
}
