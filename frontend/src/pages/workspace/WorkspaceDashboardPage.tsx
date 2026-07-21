import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Clock3, Map, Users } from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { WorkspacePageHeader } from '@/components/workspace/ui'

export const WorkspaceDashboardPage: React.FC = () => {
  const { params, isPreview } = useWorkspaceScope()
  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'dashboard', params],
    queryFn: () => workspaceApi.dashboard(params),
  })
  const { data: tasksData } = useQuery({
    queryKey: ['workspace', 'dashboard', 'roadmap-tasks', params],
    queryFn: () => workspaceApi.roadmapTasks({ ...params, status: 'open' }),
  })

  const stats = data?.stats
  const tasks = (tasksData?.items ?? []).slice(0, 5)
  const meetings = (data?.upcoming_meetings ?? []).slice(0, 4)
  const overdue = tasksData?.items.filter((task) => task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())).length ?? 0

  return (
    <div className="space-y-6 animate-fade-in">
      <WorkspacePageHeader
        eyebrow={isPreview ? 'Preview кабинета ментора' : 'Кабинет ментора'}
        title="Обзор"
        description="Здесь собраны ваши студенты, ближайшие roadmap-задачи, встречи и точки внимания."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Студенты" value={isLoading ? '…' : String(stats?.students_total ?? 0)} note="в работе" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Задачи" value={isLoading ? '…' : String(stats?.open_roadmap_tasks ?? 0)} note="открыто в roadmap" icon={<Map className="h-5 w-5" />} />
        <StatCard label="Дедлайны" value={String(overdue)} note="требуют внимания" icon={<Clock3 className="h-5 w-5" />} tone={overdue ? 'warn' : 'good'} />
        <StatCard label="Встречи" value={isLoading ? '…' : String(stats?.upcoming_meetings ?? 0)} note="запланировано" icon={<CalendarDays className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[16px] border border-p-line bg-p-panel p-4">
          <SectionHeader eyebrow="Next steps" title="Ближайшие задачи" href="/workspace/tasks" />
          {tasks.length === 0 ? <EmptyLine text="Активных roadmap-задач пока нет." /> : <div className="space-y-2">{tasks.map((task) => (
            <Link key={task.id} to={`/workspace/students/${task.student_id}#roadmap`} className="flex items-center gap-3 rounded-[12px] border border-p-line bg-p-panel2 px-3 py-3 transition-transform hover:translate-x-1">
              <span className="h-2.5 w-2.5 rounded-full bg-brand" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-p-text">{task.title}</div><div className="mt-0.5 truncate text-[11.5px] text-p-muted">{task.student_name} · {task.stage_name}</div></div>
              <span className={cn('shrink-0 rounded-full border border-p-line px-2 py-1 text-[11px] font-semibold text-p-muted', task.due_date && new Date(task.due_date) < new Date() && 'border-brand/40 text-brand')}>{task.due_date ? formatDate(task.due_date) : 'без дедлайна'}</span>
            </Link>
          ))}</div>}
        </section>

        <section className="rounded-[16px] border border-p-line bg-p-panel p-4">
          <div className="mb-4 flex items-center justify-between"><div><p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-brand">Calendar</p><h2 className="mt-1 text-base font-extrabold text-p-text">Ближайшие встречи</h2></div><CalendarDays className="h-5 w-5 text-brand" /></div>
          {meetings.length === 0 ? <EmptyLine text="Предстоящих встреч нет." /> : <div className="space-y-2">{meetings.map((row) => (
            <Link key={row.meeting.id} to={`/workspace/students/${row.student.id}#meetings`} className="block rounded-[13px] border border-p-line bg-p-panel2 p-4 transition-colors hover:border-brand-dim"><div className="text-sm font-extrabold text-p-text">{row.meeting.title}</div><div className="mt-1 text-xs text-p-muted">{formatDate(row.meeting.starts_at)} · {row.student.full_name}</div></Link>
          ))}</div>}
        </section>
      </div>
    </div>
  )
}

const StatCard: React.FC<{ label: string; value: string; note: string; icon: React.ReactNode; tone?: 'good' | 'warn' }> = ({ label, value, note, icon, tone }) => (
  <div className="relative overflow-hidden rounded-[16px] border border-p-line bg-p-panel p-4"><div className="absolute right-3 top-2 font-display text-[54px] font-black leading-none text-p-muted2 opacity-10" aria-hidden="true">{value}</div><div className={cn('mb-4 grid h-9 w-9 place-items-center rounded-[11px] bg-p-panel2 text-brand', tone === 'good' && 'text-p-good')}>{icon}</div><div className="font-display text-[34px] font-black leading-none text-p-text">{value}</div><div className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-p-muted2">{label}</div><div className="mt-1 text-xs text-p-muted">{note}</div></div>
)

const SectionHeader: React.FC<{ eyebrow: string; title: string; href: string }> = ({ eyebrow, title, href }) => <div className="mb-4 flex items-center justify-between gap-3"><div><p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-brand">{eyebrow}</p><h2 className="mt-1 text-base font-extrabold text-p-text">{title}</h2></div><Link to={href} className="text-xs font-bold text-p-muted hover:text-brand">Все задачи</Link></div>
const EmptyLine: React.FC<{ text: string }> = ({ text }) => <div className="rounded-[13px] border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted"><CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-brand" />{text}</div>
