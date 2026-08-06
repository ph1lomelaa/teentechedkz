import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ClipboardCheck, Clock3, Map, ShieldAlert, Users } from 'lucide-react'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { PageHeader, StatCard, EmptyState } from '@/components/ui'

export const WorkspaceDashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const { params, isPreview } = useWorkspaceScope()
  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'dashboard', params],
    queryFn: () => workspaceApi.dashboard(params),
  })
  const { data: tasksData } = useQuery({
    queryKey: ['workspace', 'dashboard', 'roadmap-tasks', params],
    queryFn: () => workspaceApi.roadmapTasks({ ...params, status: 'open' }),
  })
  // Тот же ключ, что у бейджа в навигации кабинета — одна правда о числе заявок
  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['workspace', 'review-count'],
    queryFn: async () => (await workspaceApi.roadmapTasks({ review_status: 'pending' })).total,
    refetchInterval: 60_000,
  })

  const stats = data?.stats
  const tasks = (tasksData?.items ?? []).slice(0, 5)
  const meetings = (data?.upcoming_meetings ?? []).slice(0, 4)
  const overdue = tasksData?.items.filter((task) => task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())).length ?? 0

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader colorPrefix="w"
        eyebrow={isPreview ? 'Preview кабинета ментора' : 'Кабинет ментора'}
        title="Обзор"
        description="Здесь собраны ваши студенты, ближайшие roadmap-задачи, встречи и точки внимания."
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard colorPrefix="w" label="Студенты" value={isLoading ? '…' : String(stats?.students_total ?? 0)} sub="в работе" icon={<Users className="h-5 w-5" />} />
        <StatCard colorPrefix="w" label="Задачи" value={isLoading ? '…' : String(stats?.open_roadmap_tasks ?? 0)} sub="открыто в roadmap" icon={<Map className="h-5 w-5" />} />
        <StatCard colorPrefix="w" label="На проверке" value={String(reviewCount)} sub="заявки студентов ждут ревью" icon={<ClipboardCheck className="h-5 w-5" />} warn={reviewCount > 0} onClick={() => navigate('/workspace/review')} />
        <StatCard colorPrefix="w" label="Дедлайны" value={String(overdue)} sub="требуют внимания" icon={<Clock3 className="h-5 w-5" />} warn={overdue > 0} />
        <StatCard colorPrefix="w" label="Встречи" value={isLoading ? '…' : String(stats?.upcoming_meetings ?? 0)} sub="запланировано" icon={<CalendarDays className="h-5 w-5" />} />
        <StatCard colorPrefix="w" label="Инциденты" value={isLoading ? '…' : String(stats?.security_incidents ?? 0)} sub="открыто" icon={<ShieldAlert className="h-5 w-5" />} warn={(stats?.security_incidents ?? 0) > 0} onClick={() => navigate('/workspace/security-incidents')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-card border border-w-line bg-w-panel p-[22px]">
          <SectionHeader eyebrow="Next steps" title="Ближайшие задачи" href="/workspace/tasks" />
          {tasks.length === 0 ? 
            <EmptyState title="Активных roadmap-задач пока нет." colorPrefix="w" /> : 
            <div>{tasks.map((task, i) => (
            <Link key={task.id} to={`/workspace/students/${task.student_id}#roadmap`} className={cn('flex items-center gap-3.5 rounded-xl border border-w-line px-3.5 py-3.5 transition-transform hover:translate-x-0 hover:border-w-accentDim hover:bg-w-panel2', i < tasks.length - 1 ? 'mb-2.5' : '')}>
              <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md border-2 border-w-accent bg-transparent" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-bold text-w-ink">{task.title}</div><div className="mt-1 truncate text-[11.5px] text-w-muted">{task.student_name} · {task.stage_name}</div></div>
              <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold tracking-wide', task.due_date && new Date(task.due_date) < new Date() ? 'bg-w-danger/15 text-w-danger' : 'bg-w-line text-w-muted')}>{task.due_date ? formatDate(task.due_date) : 'без дедлайна'}</span>
            </Link>
          ))}</div>}
        </section>

        <section className="rounded-card border border-w-line bg-w-panel p-[22px]">
          <SectionHeader eyebrow="Calendar" title="Ближайшие встречи" href="/workspace/meetings" />
          {meetings.length === 0 ? 
            <EmptyState title="Предстоящих встреч нет." colorPrefix="w" /> : 
            <div>{meetings.map((row, i) => (
            <Link key={row.meeting.id} to={`/workspace/students/${row.student.id}#meetings`} className={cn('flex items-center gap-3.5 rounded-xl border border-w-line p-3.5 transition-transform hover:translate-x-0 hover:border-w-accentDim hover:bg-w-panel2', i < meetings.length - 1 ? 'mb-2.5' : '')}><div className="min-w-0 flex-1"><div className="text-[13px] font-bold text-w-ink">{row.meeting.title}</div><div className="mt-1 text-[11.5px] text-w-muted">{formatDate(row.meeting.starts_at)} · {row.student.full_name}</div></div></Link>
          ))}</div>}
        </section>
      </div>
    </div>
  )
}

const SectionHeader: React.FC<{ eyebrow: string; title: string; href: string }> = ({ eyebrow, title, href }) => <div className="mb-4 flex items-center justify-between gap-3"><div><p className="font-display text-[11px] font-black uppercase tracking-[0.22em] text-w-accentText">{eyebrow}</p><h2 className="mt-1 font-display text-base font-extrabold text-w-ink">{title}</h2></div><Link to={href} className="text-xs font-bold text-w-muted hover:text-w-accentText">Все</Link></div>
