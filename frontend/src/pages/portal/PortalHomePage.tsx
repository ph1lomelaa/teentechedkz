import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Clock3, Map, Trophy } from 'lucide-react'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { meetingsApi, Meeting } from '@/api/meetings'
import { portalApi } from '@/api/portal'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { PageShell } from '@/components/shared/PageShell'
import { StatCard, EmptyState } from '@/components/ui'
import {
  ClaimCheckbox,
  MentorComment,
  useReviewLiveUpdates,
  useTaskClaim,
} from '@/components/portal/PortalRoadmap'

// Одна правда с дорожкой и hero-карточкой roadmap: «заполнено» =
// done (подтверждено ментором) + pending (заявка студента на проверке).
function roadmapProgress(roadmaps: Roadmap[] | undefined) {
  const tasks = (roadmaps ?? []).flatMap((r) => r.stages.flatMap((s) => s.tasks))
  const done = tasks.filter((t) => t.status === 'done').length
  const pending = tasks.filter((t) => t.status !== 'done' && t.review_status === 'pending').length
  return {
    done,
    pending,
    total: tasks.length,
    pct: tasks.length ? Math.round(((done + pending) / tasks.length) * 100) : 0,
  }
}

function dueLabel(date: string | null) {
  if (!date) return 'без дедлайна'
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function isOverdue(task: { status: string; due_date: string | null }): boolean {
  if (!task.due_date || task.status === 'done') return false
  return new Date(task.due_date) < new Date(new Date().toDateString())
}

function meetingTime(m: Meeting) {
  const start = new Date(m.starts_at)
  return `${start.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}, ${start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

export const PortalHomePage: React.FC = () => {
  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0] || 'студент'

  const { data: roadmaps } = useQuery({ queryKey: ['portal', 'roadmap'], queryFn: roadmapApi.myRoadmaps })
  const { data: tasks = [] } = useQuery({ queryKey: ['portal', 'tasks'], queryFn: roadmapApi.myTasks })
  const { data: meetings = [] } = useQuery({ queryKey: ['portal', 'meetings'], queryFn: meetingsApi.myMeetings })
  const { data: profile } = useQuery({ queryKey: ['portal', 'profile'], queryFn: portalApi.profile })

  // Заявки о выполнении прямо с главной + live-вердикты ментора
  const { claim, unclaim } = useTaskClaim()
  useReviewLiveUpdates()

  const progress = roadmapProgress(roadmaps)
  const notDone = tasks.filter((t) => t.status !== 'done')
  // «Открыто» = задачи, требующие действия студента; заявленные ждут ментора
  const openTasks = notDone.filter((t) => t.review_status !== 'pending')
  const pendingCount = notDone.length - openTasks.length
  const overdue = openTasks.filter((t) => t.due_date && new Date(t.due_date) < new Date(new Date().toDateString())).length
  const nextTasks = [...notDone]
    .sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'))
    .slice(0, 4)
  const upcoming = meetings
    .filter((m) => m.status === 'scheduled' && new Date(m.ends_at).getTime() >= Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3)

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      {/* HERO */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-2 font-display text-[11px] uppercase tracking-[.24em] text-p-accent">
            Панель студента
          </div>
          <h1 className="font-display text-4xl font-black leading-[1.05] tracking-tight text-p-text">
            Привет, <span className="text-p-accent">{firstName}</span>
          </h1>
          <p className="mt-2 max-w-[440px] text-sm text-p-muted">
            Здесь собраны ваши ближайшие задачи, встречи и общий прогресс по дорожной карте.{' '}
            <Link to="/portal/roadmap" className="font-bold text-p-accent hover:underline">
              Открыть roadmap →
            </Link>
          </p>
        </div>
      </div>

      {/* Статистика */}
      <div className="mb-6 grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          colorPrefix="p"
          label="Roadmap"
          value={`${progress.pct}%`}
          sub={
            progress.pending > 0
              ? `${progress.done} готово · ${progress.pending} на проверке`
              : `${progress.done}/${progress.total} задач`
          }
          icon={<Map className="h-4 w-4" />}
        />
        <StatCard
          colorPrefix="p"
          label="Открыто"
          value={String(openTasks.length)}
          sub={pendingCount > 0 ? `ещё ${pendingCount} на проверке` : 'активных задач'}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatCard colorPrefix="p" label="Дедлайны" value={String(overdue)} sub={overdue > 0 ? 'требуют внимания' : 'в норме'} icon={<Clock3 className="h-4 w-4" />} warn={overdue > 0} />
        <StatCard colorPrefix="p" label="Программа" value={String(profile?.student?.intake_year ?? '—')} sub={profile?.student?.degree_level || 'профиль'} icon={<Trophy className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Ближайшие задачи */}
        <div className="rounded-card border border-p-line bg-p-panel p-[22px]">
          <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-p-text">
            <CheckCircle2 className="h-5 w-5 text-p-accent" />
            Ближайшие задачи
          </h3>
          <div className="mb-4 mt-1 text-xs text-p-muted">Задачи с приоритетом и дедлайном</div>

          {nextTasks.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8" />}
              title="Задач пока нет"
              description="Новые задачи от ментора появятся здесь"
              colorPrefix="p"
            />
          ) : (
            <div>
              {nextTasks.map((t, i) => (
                <div
                  key={t.id}
                  className={cn(
                    'flex w-full items-center gap-3.5 rounded-panel border border-p-line p-3.5 text-left transition last:mb-0 hover:border-p-accent-dim hover:bg-p-panel2',
                    i < nextTasks.length - 1 ? 'mb-2.5' : ''
                  )}
                >
                  <ClaimCheckbox
                    task={t}
                    size="md"
                    onClaim={() => claim.mutate(t.id)}
                    onUnclaim={() => unclaim.mutate(t.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13.5px] font-bold text-p-text">{t.title}</b>
                    <small className={cn('block text-[11.5px]', isOverdue(t) ? 'text-p-danger' : 'text-p-muted')}>
                      Этап: {t.stage_name} · дедлайн {dueLabel(t.due_date)}
                      {t.review_status === 'pending' && ' · на проверке у ментора'}
                    </small>
                    {t.review_status === 'returned' && t.review_comment && (
                      <MentorComment comment={t.review_comment} />
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ближайшие встречи */}
        <div className="rounded-card border border-p-line bg-p-panel p-[22px]">
          <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-p-text">
            <CalendarDays className="h-5 w-5 text-p-accent" />
            Ближайшие встречи
          </h3>
          <div className="mb-4 mt-1 text-xs text-p-muted">Запланированные сессии с ментором</div>

          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-8 w-8" />}
              title="Пока встреч не запланировано"
              description="Ментор назначит созвон и он появится здесь"
              colorPrefix="p"
            />
          ) : (
            <div>
              {upcoming.map((m, i) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex items-center gap-3.5 rounded-panel border border-p-line p-3.5 transition last:mb-0 hover:border-p-accent-dim hover:bg-p-panel2',
                    i < upcoming.length - 1 ? 'mb-2.5' : ''
                  )}
                >
                  <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-ctl bg-p-panel2">
                    <CalendarDays className="h-4 w-4 text-p-accent" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-bold text-p-text">{m.title}</b>
                    <small className="block truncate text-[11.5px] text-p-muted">
                      {meetingTime(m)}
                    </small>
                  </span>
                  {m.meeting_link && (
                    <a
                      href={m.meeting_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-none whitespace-nowrap rounded-ctl bg-p-accent px-3.5 py-1.5 text-[11.5px] font-bold text-black transition hover:-translate-y-px"
                    >
                      Подключиться
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
