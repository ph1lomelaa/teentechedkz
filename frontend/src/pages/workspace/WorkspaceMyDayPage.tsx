import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, FileWarning, MessageSquareWarning, Video } from 'lucide-react'
import { workspaceApi, WorkspaceMyDayTask } from '@/api/workspace'
import { AppCard, EmptyState, PageHeader } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { CheckinBanner } from '@/components/workspace/CheckinBanner'

const URGENCY_META = {
  critical: { label: 'Критично · >72ч', className: 'border-black bg-black text-white' },
  red: { label: '48–72ч', className: 'border-red-400/60 bg-red-400/10 text-red-300' },
  orange: { label: '24–48ч', className: 'border-orange-400/60 bg-orange-400/10 text-orange-300' },
  yellow: { label: '<24ч', className: 'border-amber-400/60 bg-amber-400/10 text-amber-300' },
} as const

function TaskGroup({ urgency, tasks }: { urgency: keyof typeof URGENCY_META; tasks: WorkspaceMyDayTask[] }) {
  if (tasks.length === 0) return null
  const meta = URGENCY_META[urgency]
  return (
    <div className="space-y-2">
      <span className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-2xs font-bold uppercase tracking-wide ${meta.className}`}>
        {meta.label} · {tasks.length}
      </span>
      <div className="space-y-1.5">
        {tasks.map((task) => (
          <Link
            key={task.id}
            to={`/workspace/students/${task.student_id}`}
            className="block rounded-panel border border-w-line bg-w-panel2 p-3 text-sm transition hover:border-w-accentDim"
          >
            <div className="font-bold text-w-ink">{task.task_text}</div>
            <div className="mt-0.5 text-xs text-w-muted">{task.student_name} · до {formatDate(task.due_date)}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export const WorkspaceMyDayPage: React.FC = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'my-day'],
    queryFn: workspaceApi.myDay,
  })

  const totalOverdueTasks = data
    ? data.tasks.yellow.length + data.tasks.orange.length + data.tasks.red.length + data.tasks.critical.length
    : 0
  const nothingToDo = !isLoading && data
    && totalOverdueTasks === 0
    && data.burning_complaints.length === 0
    && data.today_meetings.length === 0
    && data.unsigned_agreements.length === 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        colorPrefix="w"
        eyebrow="Кабинет"
        title="Мой день"
        description="Всё, что нужно проверить сегодня, в одном экране: просроченные задачи, горящий SLA, встречи и регламенты."
      />

      <CheckinBanner />

      {isLoading ? (
        <div className="rounded-card border border-w-line bg-w-panel p-5 text-sm text-w-muted">Загрузка...</div>
      ) : nothingToDo ? (
        <EmptyState
          colorPrefix="w"
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="Всё чисто"
          description="Просроченных задач, горящих обращений и незакрытых регламентов нет."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {data && data.unsigned_agreements.length > 0 && (
            <AppCard colorPrefix="w" className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
                <FileWarning className="h-4 w-4 text-w-danger" />
                Неподписанные регламенты
              </div>
              <div className="flex flex-wrap gap-2">
                {data.unsigned_agreements.map((a) => (
                  <Link
                    key={a.id}
                    to="/agreements/sign"
                    className="rounded-pill border border-w-danger/50 bg-w-danger/10 px-3 py-1.5 text-xs font-bold text-w-danger transition hover:bg-w-danger/20"
                  >
                    {a.title}
                  </Link>
                ))}
              </div>
            </AppCard>
          )}

          <AppCard colorPrefix="w" className="p-5">
            <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
              <AlertTriangle className="h-4 w-4 text-w-accentText" />
              Просроченные задачи {totalOverdueTasks > 0 && `· ${totalOverdueTasks}`}
            </div>
            {totalOverdueTasks === 0 ? (
              <p className="text-sm text-w-muted">Просроченных задач нет.</p>
            ) : (
              <div className="space-y-4">
                <TaskGroup urgency="critical" tasks={data?.tasks.critical ?? []} />
                <TaskGroup urgency="red" tasks={data?.tasks.red ?? []} />
                <TaskGroup urgency="orange" tasks={data?.tasks.orange ?? []} />
                <TaskGroup urgency="yellow" tasks={data?.tasks.yellow ?? []} />
              </div>
            )}
          </AppCard>

          <AppCard colorPrefix="w" className="p-5">
            <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
              <MessageSquareWarning className="h-4 w-4 text-w-accentText" />
              Горящий SLA по обращениям
            </div>
            {(data?.burning_complaints.length ?? 0) === 0 ? (
              <p className="text-sm text-w-muted">Нет обращений с горящим сроком ответа.</p>
            ) : (
              <div className="space-y-1.5">
                {data!.burning_complaints.map((c) => (
                  <Link
                    key={c.id}
                    to="/workspace/complaints"
                    className={`block rounded-panel border p-3 text-sm transition ${
                      c.is_sla_breached
                        ? 'border-w-danger/60 bg-w-danger/10'
                        : 'border-w-line bg-w-panel2 hover:border-w-accentDim'
                    }`}
                  >
                    <div className="font-bold text-w-ink">{c.subject}</div>
                    <div className={`mt-0.5 text-xs ${c.is_sla_breached ? 'text-w-danger' : 'text-w-muted'}`}>
                      {c.is_sla_breached ? 'SLA нарушен' : `осталось ${c.hours_left}ч`}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </AppCard>

          <AppCard colorPrefix="w" className="p-5 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
              <CalendarClock className="h-4 w-4 text-w-accentText" />
              Встречи сегодня {data && data.today_meetings.length > 0 && `· ${data.today_meetings.length}`}
            </div>
            {(data?.today_meetings.length ?? 0) === 0 ? (
              <p className="text-sm text-w-muted">Встреч на сегодня нет.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {data!.today_meetings.map((m) => (
                  <div key={m.id} className="rounded-panel border border-w-line bg-w-panel2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-w-ink">{m.title}</span>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-w-accentText">
                        {new Date(m.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-w-muted">{m.student_name}</div>
                    {m.meeting_link && (
                      <a
                        href={m.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-w-accentText hover:underline"
                      >
                        <Video className="h-3 w-3" /> Присоединиться
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </AppCard>
        </div>
      )}
    </div>
  )
}
