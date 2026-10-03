import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChevronRight, MessageCircle, Mic, Phone, Route, Video } from 'lucide-react'
import type { WorkspaceStudentSummary } from '@/api/workspace'
import { AppButton, Avatar, Pill, ProgressBar } from '@/components/ui'
import { useStartNotes } from '@/hooks/useStartNotes'
import { normalizeMeetingLink } from '@/lib/meetingLink'
import { hasRoadmap, meetingTime, meetingWhen, studentSignals } from '@/lib/studentSignals'
import { MENTOR_ROLE_LABELS } from '@/types'
import { cn } from '@/lib/utils'

const WHEN_LABEL = { today: 'Сегодня', tomorrow: 'Завтра' } as const

function meetingDay(startsAt: string) {
  const when = meetingWhen(startsAt)
  if (when === 'today' || when === 'tomorrow') return WHEN_LABEL[when]
  return new Date(startsAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

/** Встреча идёт сейчас или начнётся в ближайшие полчаса — конспект привяжем к ней. */
function isLive(startsAt: string) {
  const start = new Date(startsAt).getTime()
  return Date.now() >= start - 30 * 60_000 && Date.now() <= start + 2 * 3_600_000
}

export const StudentQuickPanel: React.FC<{ item: WorkspaceStudentSummary; className?: string }> = ({ item, className }) => {
  const { student, roadmap, next_meeting: meeting } = item
  const profile = `/workspace/students/${student.id}`
  const signals = studentSignals(item)
  const link = normalizeMeetingLink(meeting?.meeting_link)
  const startNotes = useStartNotes()
  const liveMeeting = meeting && isLive(meeting.starts_at) ? meeting : undefined
  const contact = student.phone || student.portal_email

  return (
    <aside aria-label={`Студент ${student.full_name}`} className={cn('rounded-card border border-w-line bg-w-panel p-6', className)}>
      <div className="flex items-start gap-4">
        <Avatar name={student.full_name} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="break-words font-display text-xl font-extrabold leading-tight text-w-ink">{student.full_name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.my_roles.map((role) => <Pill colorPrefix="w" key={role}>{MENTOR_ROLE_LABELS[role] ?? role}</Pill>)}
            {!hasRoadmap(item) && <span className="inline-flex items-center rounded-pill bg-w-danger/10 px-3 py-1 text-2xs font-bold text-w-danger">Roadmap не назначен</span>}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2.5 rounded-panel border border-w-line bg-w-panel2 px-3.5 py-3 text-sm">
          <Phone className="h-4 w-4 shrink-0 text-w-muted" />
          {contact
            ? <a href={student.phone ? `tel:${student.phone}` : `mailto:${student.portal_email}`} className="truncate font-semibold text-w-ink hover:text-w-accentText">{contact}</a>
            : <span className="truncate text-w-muted">Контакт не указан</span>}
        </div>
        <div className="flex min-w-0 items-center gap-2.5 rounded-panel border border-w-line bg-w-panel2 px-3.5 py-3 text-sm">
          <CalendarDays className="h-4 w-4 shrink-0 text-w-muted" />
          {meeting
            ? <span className="truncate text-w-ink"><b className="text-w-accentText">{meetingDay(meeting.starts_at)}</b> · {meetingTime(meeting.starts_at)}</span>
            : <span className="truncate text-w-muted">Встреч нет</span>}
        </div>
      </div>

      {hasRoadmap(item) ? (
        <section className="mt-5 rounded-panel border border-w-line bg-w-panel2 p-4">
          <div className="flex items-center justify-between gap-3">
            <b className="min-w-0 truncate text-sm font-bold text-w-ink">{roadmap.name || 'Roadmap'}</b>
            <span className="shrink-0 font-display text-sm font-black text-w-accentText">{roadmap.progress}%</span>
          </div>
          <ProgressBar colorPrefix="w" showLabel={false} value={roadmap.progress} className="mt-3" />
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-w-muted">
            <span>{roadmap.tasks_done} из {roadmap.tasks_total} выполнено</span>
            <Link to={`${profile}#roadmap`} className="font-bold hover:text-w-accentText">{item.open_roadmap_tasks} открыто</Link>
          </div>
        </section>
      ) : (
        <section className="mt-5 rounded-panel border border-dashed border-w-danger/50 bg-w-danger/[.06] p-4">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-w-danger/15 text-w-danger"><Route className="h-4 w-4" /></span>
            <div className="min-w-0">
              <b className="block text-sm font-bold text-w-ink">Roadmap ещё не назначен</b>
              <p className="mt-0.5 text-xs text-w-muted">Выберите шаблон — задачи с дедлайнами появятся автоматически.</p>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Link to={`${profile}#roadmap`} className="inline-flex min-h-9 items-center rounded-ctl bg-w-accent px-4 text-xs font-black text-black transition hover:-translate-y-px">Назначить roadmap</Link>
            <Link to="/workspace/roadmap" className="inline-flex min-h-9 items-center rounded-ctl border border-w-line px-4 text-xs font-bold text-w-ink transition hover:border-w-accentDim">Шаблоны</Link>
          </div>
        </section>
      )}

      {meeting && (
        <section className="mt-5">
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-w-muted">Ближайшее</h3>
          <div className="flex items-center gap-3 rounded-panel border border-w-line bg-w-panel2 py-3 pl-3 pr-3">
            <span aria-hidden="true" className="h-9 w-1 shrink-0 rounded-full bg-w-accent" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-w-ink">{meeting.title}</div>
              <div className="text-xs text-w-muted">{meetingDay(meeting.starts_at)}, {meetingTime(meeting.starts_at)}</div>
            </div>
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer" aria-label="Войти во встречу" className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl border border-w-line text-w-ink transition hover:border-w-accentDim hover:text-w-accentText">
                <Video className="h-4 w-4" />
              </a>
            )}
          </div>
        </section>
      )}

      {signals.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-w-muted">Ждёт вас</h3>
          <ul className="divide-y divide-w-line rounded-panel border border-w-line">
            {signals.map((signal) => (
              <li key={signal.key}>
                <Link to={signal.href} className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-w-ink transition hover:bg-w-panel2">
                  <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', signal.tone === 'danger' ? 'bg-w-danger' : 'bg-w-muted2')} />
                  <span className={cn('min-w-0 flex-1 truncate', signal.tone === 'info' && 'text-w-muted')}>{signal.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-w-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {/* Не инверсия (bg-w-ink): рядом жёлтая «Назначить roadmap», и белая/чёрная
            плашка спорила с ней за главную кнопку в обеих темах. Мягкая заливка
            панели — чуть заметнее «Написать в чат», но не кричит. */}
        <Link to={profile} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-ctl border border-w-line bg-w-panel2 px-4 text-sm font-bold text-w-ink transition hover:border-w-accentDim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Открыть профиль <ArrowRight className="h-4 w-4" />
        </Link>
        <Link to={`/workspace/chat?student_id=${student.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-ctl border border-w-line px-4 text-sm font-bold text-w-ink transition hover:border-w-accentDim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MessageCircle className="h-4 w-4" /> Написать в чат
        </Link>
      </div>
      <AppButton
        colorPrefix="w"
        variant="ghost"
        size="sm"
        className="mt-2 w-full"
        disabled={startNotes.isPending}
        title={liveMeeting ? `Привяжем к встрече «${liveMeeting.title}»` : 'Запись, бот на встречу или загрузка аудио'}
        onClick={() => startNotes.mutate({ studentId: student.id, studentName: student.full_name, meeting: liveMeeting })}
      >
        <Mic className="h-4 w-4" />{liveMeeting ? 'Конспект встречи' : 'Начать конспект'}
      </AppButton>
    </aside>
  )
}
