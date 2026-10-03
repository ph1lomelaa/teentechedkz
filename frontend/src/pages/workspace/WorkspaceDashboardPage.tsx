import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Users } from 'lucide-react'
import { workspaceApi, type WorkspaceDashboard } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { useAuth } from '@/contexts/AuthContext'
import { cn, formatDate } from '@/lib/utils'
import { Avatar, EmptyState } from '@/components/ui'
import { QueryError } from '@/components/shared/QueryState'
import { FocusBanner } from '@/components/workspace/FocusBanner'
import { NextMeetingTile } from '@/components/workspace/NextMeetingTile'
import { hasRoadmap, meetingTime, meetingWhen, pickFocus, sortByUrgency, studentHeadline } from '@/lib/studentSignals'

function greeting(hour: number) {
  if (hour < 5) return 'Доброй ночи'
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

type UpcomingMeeting = WorkspaceDashboard['upcoming_meetings'][number]

function dayLabel(iso: string) {
  const when = meetingWhen(iso)
  const date = new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
  if (when === 'today') return `Сегодня · ${date}`
  if (when === 'tomorrow') return `Завтра · ${date}`
  const weekday = new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${date}`
}

export const WorkspaceDashboardPage: React.FC = () => {
  const { user } = useAuth()
  const { params, isPreview } = useWorkspaceScope()
  const { data, isLoading, isError, error, refetch } = useQuery({
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
  const students = data?.students ?? []
  const tasks = (tasksData?.items ?? []).slice(0, 5)
  const today = new Date(new Date().toDateString())
  const overdue = tasksData?.items.filter((task) => task.due_date && new Date(task.due_date) < today).length ?? 0
  const withoutRoadmap = students.filter((item) => !hasRoadmap(item)).map((item) => item.student.full_name)
  const focus = data ? pickFocus({ incidents: stats?.security_incidents ?? 0, overdue, review: reviewCount, withoutRoadmap }) : null

  const meetings = data?.upcoming_meetings ?? []
  const meetingsToday = meetings.filter((row) => meetingWhen(row.meeting.starts_at) === 'today').length
  const meetingsTomorrow = meetings.filter((row) => meetingWhen(row.meeting.starts_at) === 'tomorrow').length
  const meetingDays = new Map<string, UpcomingMeeting[]>()
  meetings.slice(0, 6).forEach((row) => {
    const key = dayLabel(row.meeting.starts_at)
    meetingDays.set(key, [...(meetingDays.get(key) ?? []), row])
  })
  const topStudents = sortByUrgency(students).slice(0, 5)

  const studentsTotal = stats?.students_total ?? students.length
  const noRoadmap = stats?.without_roadmap ?? withoutRoadmap.length
  const firstName = (user?.name || '').replace(/\[[^\]]*\]/g, '').trim().split(/\s+/)[0]
  const now = new Date()
  const dateLine = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <div className="min-w-0">
          <p className="text-sm text-w-muted">{isPreview ? 'Preview кабинета ментора · ' : ''}{dateLine.charAt(0).toUpperCase() + dateLine.slice(1)}</p>
          <h1 className="mt-1.5 font-display text-3xl font-black leading-tight tracking-[-0.01em] text-w-ink md:text-4xl">
            {greeting(now.getHours())}{firstName && !isPreview ? `, ${firstName}` : ''}
          </h1>
        </div>
      </header>

      {/* Плитки при ошибке показывали «0» по каждому показателю — ноль это
          утверждение, и оно успокаивает сильнее пустого экрана. */}
      {isError && <QueryError colorPrefix="w" error={error} onRetry={refetch} />}

      {focus && <FocusBanner focus={focus} />}

      {!isError && (
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.25fr]">
          <MetricTile
            icon={<Users className="h-4 w-4" />}
            label="Студенты"
            value={isLoading ? '…' : String(studentsTotal)}
            parts={[{ value: studentsTotal - noRoadmap, className: 'bg-w-good' }, { value: noRoadmap, className: 'bg-w-danger' }]}
            sub={isLoading ? '' : noRoadmap === 0 ? 'у всех есть roadmap' : noRoadmap === studentsTotal ? `все ${studentsTotal} ждут roadmap` : `${studentsTotal - noRoadmap} в работе · ${noRoadmap} без roadmap`}
            href="/workspace/students"
          />
          <MetricTile
            icon={<CalendarDays className="h-4 w-4" />}
            label="Встречи"
            value={isLoading ? '…' : String(stats?.upcoming_meetings ?? meetings.length)}
            parts={[{ value: meetingsToday, className: 'bg-w-accent' }, { value: Math.max((stats?.upcoming_meetings ?? meetings.length) - meetingsToday, 0), className: 'bg-w-line' }]}
            sub={isLoading ? '' : meetings.length === 0 ? 'ничего не запланировано' : `${meetingsToday} сегодня, ${meetingsTomorrow} завтра`}
            href="/workspace/meetings"
          />
          <NextMeetingTile row={meetings[0]} loading={isLoading} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-card border border-w-line bg-w-panel p-[22px]">
          <SectionHeader title="Ближайшие встречи" href="/workspace/meetings" link="Календарь" />
          {meetings.length === 0 ? (
            <EmptyState title="Предстоящих встреч нет." colorPrefix="w" />
          ) : (
            <div className="space-y-4">
              {[...meetingDays.entries()].map(([day, rows]) => (
                <div key={day}>
                  <p className={cn('mb-2 text-[11px] font-black uppercase tracking-[0.16em]', day.startsWith('Сегодня') ? 'text-w-accentText' : 'text-w-muted')}>{day}</p>
                  <div className="space-y-2">
                    {rows.map((row) => (
                      <Link key={row.meeting.id} to={`/workspace/students/${row.student.id}#meetings`} className="flex items-center gap-3 rounded-panel border border-w-line bg-w-panel2 py-3 pl-3 pr-3.5 transition hover:border-w-accentDim">
                        <span aria-hidden="true" className={cn('h-9 w-1 shrink-0 rounded-full', meetingWhen(row.meeting.starts_at) === 'today' ? 'bg-w-accent' : 'bg-w-line')} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-w-ink">{row.meeting.title}</div>
                          <div className="truncate text-xs text-w-muted">{meetingTime(row.meeting.starts_at)} · {row.student.full_name}</div>
                        </div>
                        <Avatar name={row.student.full_name} size={32} />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-card border border-w-line bg-w-panel p-[22px]">
          <SectionHeader title="Мои студенты" href="/workspace/students" link={students.length ? `Все ${students.length}` : 'Все'} />
          {topStudents.length === 0 ? (
            <EmptyState title="Студентов пока нет." colorPrefix="w" />
          ) : (
            <div className="divide-y divide-w-line">
              {topStudents.map((item) => {
                const headline = studentHeadline(item)
                return (
                  <Link key={item.student.id} to={`/workspace/students?s=${item.student.id}`} className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Avatar name={item.student.full_name} size={36} />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-w-ink group-hover:text-w-accentText">{item.student.full_name}</span>
                    <span className={cn(
                      'max-w-[46%] shrink-0 truncate rounded-pill px-2.5 py-1 text-[11px] font-semibold',
                      headline.tone === 'danger' ? 'bg-w-danger/10 text-w-danger' : headline.tone === 'accent' ? 'bg-w-accent/15 text-w-accentText' : 'text-w-muted',
                    )}>{headline.text}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {tasks.length > 0 && (
        <section className="min-w-0 rounded-card border border-w-line bg-w-panel p-[22px]">
          <SectionHeader title="Ближайшие задачи" href="/workspace/tasks" link="Все" />
          <div className="space-y-2">
            {tasks.map((task) => {
              const late = Boolean(task.due_date && new Date(task.due_date) < today)
              return (
                <Link key={task.id} to={`/workspace/students/${task.student_id}#roadmap`} className="flex items-center gap-3.5 rounded-panel border border-w-line px-3.5 py-3 transition hover:border-w-accentDim hover:bg-w-panel2">
                  <span className="h-[18px] w-[18px] flex-none rounded-md border-2 border-w-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-w-ink">{task.title}</div>
                    <div className="mt-0.5 truncate text-xs text-w-muted">{task.student_name} · {task.stage_name}</div>
                  </div>
                  <span className={cn('shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-bold', late ? 'bg-w-danger/10 text-w-danger' : 'bg-w-line text-w-muted')}>{task.due_date ? formatDate(task.due_date) : 'без дедлайна'}</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

const MetricTile: React.FC<{
  icon: React.ReactNode
  label: string
  value: string
  parts: Array<{ value: number; className: string }>
  sub: string
  href: string
}> = ({ icon, label, value, parts, sub, href }) => {
  const total = parts.reduce((sum, part) => sum + Math.max(part.value, 0), 0)
  return (
    <Link to={href} className="block rounded-card border border-w-line bg-w-panel p-5 transition hover:border-w-accentDim">
      <div className="flex items-center gap-2 text-sm text-w-muted">{icon}{label}</div>
      <div className="mt-3 font-display text-4xl font-black leading-none text-w-ink">{value}</div>
      <div className="mt-4 flex h-1.5 gap-1 overflow-hidden rounded-full" aria-hidden="true">
        {total === 0
          ? <span className="h-full flex-1 rounded-full bg-w-line" />
          : parts.filter((part) => part.value > 0).map((part, i) => <span key={i} className={cn('h-full rounded-full', part.className)} style={{ flexGrow: part.value }} />)}
      </div>
      <p className="mt-2.5 min-h-[1rem] text-xs text-w-muted">{sub}</p>
    </Link>
  )
}

const SectionHeader: React.FC<{ title: string; href: string; link: string }> = ({ title, href, link }) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <h2 className="font-display text-base font-extrabold text-w-ink">{title}</h2>
    <Link to={href} className="text-xs font-bold text-w-accentText hover:underline">{link}</Link>
  </div>
)
