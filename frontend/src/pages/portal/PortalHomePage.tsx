import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Clock3, Map, Trophy } from 'lucide-react'
import { roadmapApi, FlatTask, Roadmap } from '@/api/roadmap'
import { meetingsApi, Meeting } from '@/api/meetings'
import { portalApi } from '@/api/portal'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

function roadmapProgress(roadmap: Roadmap | null | undefined) {
  const tasks = roadmap?.stages.flatMap((s) => s.tasks) ?? []
  const done = tasks.filter((t) => t.status === 'done').length
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 }
}

function dueLabel(date: string | null) {
  if (!date) return 'без дедлайна'
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function meetingTime(m: Meeting) {
  const start = new Date(m.starts_at)
  return `${start.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}, ${start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

export const PortalHomePage: React.FC = () => {
  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0] || 'студент'

  const { data: roadmap } = useQuery({ queryKey: ['portal', 'roadmap'], queryFn: roadmapApi.myRoadmap })
  const { data: tasks = [] } = useQuery({ queryKey: ['portal', 'tasks'], queryFn: roadmapApi.myTasks })
  const { data: meetings = [] } = useQuery({ queryKey: ['portal', 'meetings'], queryFn: meetingsApi.myMeetings })
  const { data: profile } = useQuery({ queryKey: ['portal', 'profile'], queryFn: portalApi.profile })

  const progress = roadmapProgress(roadmap)
  const openTasks = tasks.filter((t) => t.status !== 'done')
  const overdue = openTasks.filter((t) => t.due_date && new Date(t.due_date) < new Date(new Date().toDateString())).length
  const nextTasks = [...openTasks]
    .sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'))
    .slice(0, 4)
  const upcoming = meetings
    .filter((m) => m.status === 'scheduled' && new Date(m.ends_at).getTime() >= Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3)

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
      <section>
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Student portal</p>
        <h1 className="mt-2 font-display text-[28px] font-black leading-tight text-p-text md:text-[34px]">
          Привет, {firstName}. <span className="text-brand">Фокус на поступление.</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-p-muted">
          Здесь собраны ваши ближайшие задачи, встречи и общий прогресс по дорожной карте.{' '}
          <Link to="/portal/roadmap" className="font-bold text-brand hover:underline">
            Открыть roadmap →
          </Link>
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Roadmap" value={`${progress.pct}%`} note={`${progress.done}/${progress.total} задач`} icon={<Map className="h-5 w-5" />} />
        <StatCard label="Открыто" value={String(openTasks.length)} note="активных задач" icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Дедлайны" value={String(overdue)} note="требуют внимания" icon={<Clock3 className="h-5 w-5" />} tone={overdue > 0 ? 'warn' : 'good'} />
        <StatCard label="Программа" value={String(profile?.student?.intake_year ?? '—')} note={profile?.student?.degree_level || 'профиль'} icon={<Trophy className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[16px] border border-p-line bg-p-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-brand">Next steps</p>
              <h2 className="mt-1 text-base font-extrabold text-p-text">Ближайшие задачи</h2>
            </div>
            <Link to="/portal/tasks" className="text-xs font-bold text-p-muted hover:text-brand">Все задачи</Link>
          </div>
          {nextTasks.length === 0 ? (
            <EmptyLine text="Активных задач пока нет." />
          ) : (
            <div className="space-y-2">
              {nextTasks.map((task) => <TaskLine key={task.id} task={task} />)}
            </div>
          )}
        </section>

        <section className="rounded-[16px] border border-p-line bg-p-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-brand">Calendar</p>
              <h2 className="mt-1 text-base font-extrabold text-p-text">Ближайшие встречи</h2>
            </div>
            <CalendarDays className="h-5 w-5 text-brand" />
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-2">
              {upcoming.map((m) => (
                <div key={m.id} className="rounded-[13px] border border-p-line bg-p-panel2 p-4">
                  <div className="text-sm font-extrabold text-p-text">{m.title}</div>
                  <div className="mt-1 text-xs text-p-muted">{meetingTime(m)}</div>
                  {m.meeting_link && (
                    <a href={m.meeting_link} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-9 items-center rounded-[10px] bg-brand px-3 text-xs font-extrabold text-black hover:bg-brand-dark">
                      Подключиться
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine text="Предстоящих встреч нет." />
          )}
        </section>
      </div>
    </div>
  )
}

const StatCard: React.FC<{ label: string; value: string; note: string; icon: React.ReactNode; tone?: 'good' | 'warn' }> = ({
  label,
  value,
  note,
  icon,
  tone,
}) => (
  <div className="relative overflow-hidden rounded-[16px] border border-p-line bg-p-panel p-4">
    <div className="absolute right-3 top-2 font-display text-[54px] font-black leading-none text-p-muted2 opacity-10" aria-hidden="true">
      {value}
    </div>
    <div className={cn('mb-4 grid h-9 w-9 place-items-center rounded-[11px] bg-p-panel2 text-brand', tone === 'good' && 'text-p-good', tone === 'warn' && 'text-brand')}>
      {icon}
    </div>
    <div className="font-display text-[34px] font-black leading-none text-p-text">{value}</div>
    <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-p-muted2">{label}</div>
    <div className="mt-1 text-xs text-p-muted">{note}</div>
  </div>
)

const TaskLine: React.FC<{ task: FlatTask }> = ({ task }) => (
  <div className="flex items-center gap-3 rounded-[12px] border border-p-line bg-p-panel2 px-3 py-3 transition-transform hover:translate-x-1">
    <span className={cn('h-2.5 w-2.5 rounded-full', task.status === 'in_progress' ? 'bg-brand' : 'bg-p-muted2')} />
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-bold text-p-text">{task.title}</div>
      <div className="mt-0.5 text-[11.5px] text-p-muted">{task.stage_name}</div>
    </div>
    <span className="shrink-0 rounded-full border border-p-line px-2 py-1 text-[11px] font-semibold text-p-muted">
      {dueLabel(task.due_date)}
    </span>
  </div>
)

const EmptyLine: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-[13px] border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">
    {text}
  </div>
)
