import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Clock3, Map, Users } from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { WorkspacePageHeader } from '@/components/workspace/ui'
import { StatCard, EmptyState } from '@/components/ui'

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

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard colorPrefix="p" label="Студенты" value={isLoading ? '…' : String(stats?.students_total ?? 0)} sub="в работе" icon={<Users className="h-5 w-5" />} />
        <StatCard colorPrefix="p" label="Задачи" value={isLoading ? '…' : String(stats?.open_roadmap_tasks ?? 0)} sub="открыто в roadmap" icon={<Map className="h-5 w-5" />} />
        <StatCard colorPrefix="p" label="Дедлайны" value={String(overdue)} sub="требуют внимания" icon={<Clock3 className="h-5 w-5" />} warn={overdue > 0} />
        <StatCard colorPrefix="p" label="Встречи" value={isLoading ? '…' : String(stats?.upcoming_meetings ?? 0)} sub="запланировано" icon={<CalendarDays className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-card border border-p-line bg-p-panel p-[22px]">
          <SectionHeader eyebrow="Next steps" title="Ближайшие задачи" href="/workspace/tasks" />
          {tasks.length === 0 ? 
            <EmptyState title="Активных roadmap-задач пока нет." colorPrefix="p" /> : 
            <div>{tasks.map((task, i) => (
            <Link key={task.id} to={`/workspace/students/${task.student_id}#roadmap`} className={cn('flex items-center gap-3.5 rounded-xl border border-p-line px-3.5 py-3.5 transition-transform hover:translate-x-0 hover:border-p-accent-dim hover:bg-p-panel2', i < tasks.length - 1 ? 'mb-2.5' : '')}>
              <span className="h-[22px] w-[22px] rounded-md bg-p-accent grid place-items-center flex-none" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-bold text-p-text">{task.title}</div><div className="mt-1 truncate text-[11.5px] text-p-muted">{task.student_name} · {task.stage_name}</div></div>
              <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold tracking-wide', task.due_date && new Date(task.due_date) < new Date() ? 'bg-p-danger/15 text-p-danger' : 'bg-[#232323] text-p-muted')}>{task.due_date ? formatDate(task.due_date) : 'без дедлайна'}</span>
            </Link>
          ))}</div>}
        </section>

        <section className="rounded-card border border-p-line bg-p-panel p-[22px]">
          <SectionHeader eyebrow="Calendar" title="Ближайшие встречи" href="/workspace/meetings" />
          {meetings.length === 0 ? 
            <EmptyState title="Предстоящих встреч нет." colorPrefix="p" /> : 
            <div>{meetings.map((row, i) => (
            <Link key={row.meeting.id} to={`/workspace/students/${row.student.id}#meetings`} className={cn('flex items-center gap-3.5 rounded-xl border border-p-line p-3.5 transition-transform hover:translate-x-0 hover:border-p-accent-dim hover:bg-p-panel2', i < meetings.length - 1 ? 'mb-2.5' : '')}><div className="min-w-0 flex-1"><div className="text-[13px] font-bold text-p-text">{row.meeting.title}</div><div className="mt-1 text-[11.5px] text-p-muted">{formatDate(row.meeting.starts_at)} · {row.student.full_name}</div></div></Link>
          ))}</div>}
        </section>
      </div>
    </div>
  )
}

const SectionHeader: React.FC<{ eyebrow: string; title: string; href: string }> = ({ eyebrow, title, href }) => <div className="mb-4 flex items-center justify-between gap-3"><div><p className="font-display text-[11px] font-black uppercase tracking-[0.22em] text-p-accent">{eyebrow}</p><h2 className="mt-1 font-display text-base font-extrabold text-p-text">{title}</h2></div><Link to={href} className="text-xs font-bold text-p-muted hover:text-p-accent">Все</Link></div>
