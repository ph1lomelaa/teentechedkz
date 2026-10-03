import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Mic, Plus, Video } from 'lucide-react'
import type { WorkspaceDashboard } from '@/api/workspace'
import { useStartNotes } from '@/hooks/useStartNotes'
import { normalizeMeetingLink } from '@/lib/meetingLink'
import { meetingCountdown } from '@/lib/studentSignals'
import { cn } from '@/lib/utils'

type Row = WorkspaceDashboard['upcoming_meetings'][number]

/** Ближайшая встреча с двумя действиями: войти и вести конспект. */
export const NextMeetingTile: React.FC<{ row?: Row; loading?: boolean }> = ({ row, loading }) => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const startNotes = useStartNotes()

  if (!row) {
    return (
      <section className="flex flex-col justify-between rounded-card border border-dashed border-w-line p-5">
        <div className="flex items-center gap-2 text-sm text-w-muted"><CalendarClock className="h-4 w-4" />Следующая встреча</div>
        <p className="mt-3 text-sm text-w-muted">{loading ? 'Загружаем…' : 'Встреч пока не запланировано.'}</p>
        {!loading && (
          <Link to="/workspace/meetings?new=1" className="mt-4 inline-flex min-h-9 items-center gap-1.5 self-start rounded-ctl border border-w-line px-3.5 text-xs font-bold text-w-ink transition hover:border-w-accentDim">
            <Plus className="h-3.5 w-3.5" /> Назначить
          </Link>
        )}
      </section>
    )
  }

  const { meeting, student } = row
  const countdown = meetingCountdown(meeting.starts_at, now)
  const link = normalizeMeetingLink(meeting.meeting_link)
  return (
    <section className={cn('flex flex-col rounded-card border p-5', countdown.live ? 'border-w-accent bg-w-accent/[.06]' : 'border-w-line bg-w-panel')}>
      <div className="flex items-center gap-2 text-sm text-w-muted">
        <CalendarClock className="h-4 w-4" />Следующая встреча
        {countdown.live && <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-w-accent" aria-hidden="true" />}
      </div>
      <p className={cn('mt-3 text-sm font-bold', countdown.live ? 'text-w-accentText' : 'text-w-ink')}>{countdown.text}</p>
      <Link to={`/workspace/students/${student.id}#meetings`} className="mt-1 block min-w-0 hover:underline">
        <span className="block truncate text-[15px] font-extrabold text-w-ink">{meeting.title}</span>
        <span className="block truncate text-xs text-w-muted">{student.full_name}</span>
      </Link>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-ctl bg-w-accent px-3.5 text-xs font-black text-black transition hover:-translate-y-px">
            <Video className="h-3.5 w-3.5" /> Войти
          </a>
        )}
        <button
          type="button"
          disabled={startNotes.isPending}
          onClick={() => startNotes.mutate({ studentId: student.id, studentName: student.full_name, meeting })}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-ctl border border-w-line px-3.5 text-xs font-bold text-w-ink transition hover:border-w-accentDim disabled:opacity-50"
        >
          <Mic className="h-3.5 w-3.5" /> Конспект
        </button>
      </div>
    </section>
  )
}
