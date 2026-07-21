import React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { CalendarDays, Video, FileText, PlayCircle, Download, ChevronRight } from 'lucide-react'
import { meetingsApi, Meeting } from '@/api/meetings'
import { portalApi } from '@/api/portal'
import { PortalMonthCalendar } from '@/components/portal/PortalMonthCalendar'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { PageShell } from '@/components/shared/PageShell'

function d(iso: string) {
  return new Date(iso)
}
function dayNum(iso: string) {
  return d(iso).getDate()
}
function monthShort(iso: string) {
  return d(iso).toLocaleString('ru-RU', { month: 'short' })
}
function timeRange(a: string, b: string) {
  const opt = { hour: '2-digit', minute: '2-digit' } as const
  return `${d(a).toLocaleTimeString('ru-RU', opt)} – ${d(b).toLocaleTimeString('ru-RU', opt)}`
}
function weekday(iso: string) {
  return d(iso).toLocaleDateString('ru-RU', { weekday: 'short' })
}

export const PortalMeetingsPage: React.FC = () => {
  const [showPast, setShowPast] = useLocalState('portal:meetings:showPast', true)

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ['portal', 'meetings'],
    queryFn: meetingsApi.myMeetings,
  })

  const downloadMutation = useMutation({
    mutationFn: () => portalApi.downloadMeetingsIcal(),
    onError: () => toast({ title: 'Не удалось скачать файл', variant: 'destructive' }),
  })

  const now = Date.now()
  const active = meetings.filter((m) => m.status !== 'cancelled')
  const upcoming = active
    .filter((m) => new Date(m.ends_at).getTime() >= now && m.status === 'scheduled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = active
    .filter((m) => !(new Date(m.ends_at).getTime() >= now && m.status === 'scheduled'))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
      <div className="flex items-center justify-between gap-4">
        <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Встречи</h1>
        {meetings.length > 0 && (
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            className="mt-2 flex items-center gap-2 px-3 py-2 rounded-[11px] text-sm font-semibold bg-w-accent text-black hover:bg-w-accent/90 disabled:opacity-50 transition"
            title="Скачать встречи в формате iCal"
          >
            <Download className="w-4 h-4" />
            .ics
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : active.length === 0 ? (
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
          <div className="w-11 h-11 rounded-[13px] bg-brand/15 grid place-items-center mx-auto">
            <CalendarDays className="w-5 h-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Встреч пока нет</h2>
          <p className="mt-1.5 text-sm text-p-muted">Ментор назначит встречи — они появятся здесь.</p>
        </div>
      ) : (
        <div className="space-y-7">
          <PortalMonthCalendar meetings={active} />
          {upcoming.length > 0 && (
            <Section title="Предстоящие">
              {upcoming.map((m) => (
                <MeetingCard key={m.id} m={m} upcoming />
              ))}
            </Section>
          )}
          {past.length > 0 && (
            <Section
              title="Прошедшие"
              expandable
              expanded={showPast}
              onToggle={() => setShowPast(!showPast)}
            >
              {showPast && past.map((m) => (
                <MeetingCard key={m.id} m={m} />
              ))}
            </Section>
          )}
        </div>
      )}
    </PageShell>
  )
}

const Section: React.FC<{
  title: string
  children: React.ReactNode
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
}> = ({ title, children, expandable, expanded, onToggle }) => (
  <section>
    <div className="flex items-center gap-2 mb-3">
      {expandable && (
        <button
          type="button"
          onClick={onToggle}
          className="text-brand hover:text-brand/80 transition"
          aria-expanded={expanded}
        >
          <ChevronRight
            className="h-4 w-4 transition-transform"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          />
        </button>
      )}
      <h2 className="font-display text-xs font-black uppercase tracking-[0.2em] text-brand">{title}</h2>
      <span className="flex-1 h-px bg-p-line" />
    </div>
    {(!expandable || expanded) && <div className="space-y-2">{children}</div>}
  </section>
)

const MeetingCard: React.FC<{ m: Meeting; upcoming?: boolean }> = ({ m, upcoming }) => (
  <div className="flex gap-4 border border-p-line rounded-[16px] bg-p-panel p-4">
    <div className="text-center border border-p-line rounded-[13px] bg-p-panel2 px-3 py-2 shrink-0 h-fit">
      <div className="font-display text-2xl font-black tabular-nums leading-none text-p-text">{dayNum(m.starts_at)}</div>
      <div className="text-[9px] uppercase tracking-wider text-brand mt-1 font-black">{monthShort(m.starts_at)}</div>
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-extrabold text-p-text">{m.title}</div>
      <div className="text-[12px] text-p-muted mt-1 capitalize">
        {weekday(m.starts_at)}, {timeRange(m.starts_at, m.ends_at)}
      </div>
      {m.description && <p className="text-[12.5px] text-p-muted mt-1.5">{m.description}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        {upcoming && m.meeting_link && (
          <a
            href={m.meeting_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-extrabold bg-brand text-black px-3 py-1.5 rounded-[10px] hover:bg-brand-dark"
          >
            <Video className="w-3.5 h-3.5" /> Подключиться
          </a>
        )}
        {!upcoming && m.recording_url && (
          <a
            href={m.recording_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold border border-p-line text-p-muted px-3 py-1.5 rounded-[10px] hover:text-p-text hover:bg-p-panel2"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Запись
          </a>
        )}
        {!upcoming && m.transcript_url && (
          <a
            href={m.transcript_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold border border-p-line text-p-muted px-3 py-1.5 rounded-[10px] hover:text-p-text hover:bg-p-panel2"
          >
            <FileText className="w-3.5 h-3.5" /> Транскрипт
          </a>
        )}
      </div>
    </div>
  </div>
)
