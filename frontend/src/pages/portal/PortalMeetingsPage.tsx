import React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { CalendarDays, Video, FileText, PlayCircle, Download, Clock3 } from 'lucide-react'
import { meetingsApi, Meeting } from '@/api/meetings'
import { portalApi } from '@/api/portal'
import { PortalMonthCalendar } from '@/components/portal/PortalMonthCalendar'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { PageShell } from '@/components/shared/PageShell'
import { AppButton, SegmentedTabs } from '@/components/ui'

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

function monthRu(iso: string) {
  return d(iso).toLocaleDateString('ru-RU', { month: 'long' })
}

function statusLabel(status: Meeting['status']) {
  if (status === 'scheduled') return 'Запланирована'
  if (status === 'completed') return 'Прошла'
  return 'Отменена'
}

function statusTone(status: Meeting['status']) {
  if (status === 'completed') return 'bg-p-good/25 text-p-good'
  if (status === 'cancelled') return 'bg-p-danger/20 text-p-danger'
  return 'bg-brand/20 text-brand'
}

export const PortalMeetingsPage: React.FC = () => {
  const [view, setView] = useLocalState<'list' | 'calendar'>('portal:meetings:view', 'list')

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
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Календарь сопровождения</p>
      <h1 className="mt-2 font-display text-3xl font-black leading-none tracking-tight text-p-text sm:text-[40px]">Встречи</h1>
      <p className="mt-2 max-w-[520px] text-sm text-p-muted">
        Созвоны с ментором: планируйте, подключайтесь и возвращайтесь к записям.
      </p>

      <div className="mt-5 mb-5 flex flex-wrap items-center gap-2">
        <SegmentedTabs
          colorPrefix="p"
          tabs={[
            { value: 'list', label: 'Список' },
            { value: 'calendar', label: 'Календарь' },
          ]}
          value={view}
          onChange={(value) => setView(value as 'list' | 'calendar')}
        />
        {meetings.length > 0 && (
          <AppButton
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            size="sm"
            variant="subtle"
            colorPrefix="p"
            className="ml-auto"
            title="Скачать встречи в формате iCal"
          >
            <Download className="h-4 w-4" />
            .ics
          </AppButton>
        )}
      </div>

      {isLoading && meetings.length === 0 ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : active.length === 0 ? (
        <div className="rounded-card border border-p-line bg-p-panel p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-panel bg-brand/15">
            <CalendarDays className="h-5 w-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Встреч пока нет</h2>
          <p className="mt-1.5 text-sm text-p-muted">Ментор назначит встречи — они появятся здесь.</p>
        </div>
      ) : (
        <>
          {view === 'calendar' ? (
            <PortalMonthCalendar meetings={active} />
          ) : (
            <div className="space-y-6">
              <section>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="h-4 w-1 rounded bg-p-accent" />
                  <b className="font-display text-[29px] leading-none font-extrabold text-p-text">Предстоящие</b>
                  <span className="rounded-full bg-p-line/80 px-2.5 py-0.5 text-[10px] font-bold text-p-muted2">{upcoming.length}</span>
                </div>
                {upcoming.length === 0 ? (
                  <div className="rounded-card border border-p-line bg-p-panel p-10 text-center">
                    <div className="mx-auto grid h-11 w-11 place-items-center rounded-panel bg-p-panel2">
                      <CalendarDays className="h-5 w-5 text-p-muted" />
                    </div>
                    <h3 className="mt-4 text-[16px] font-extrabold text-p-text">Нет предстоящих встреч</h3>
                    <p className="mt-1 text-[12px] text-p-muted">Ментор назначит созвон и он появится здесь</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {upcoming.map((m) => <MeetingCard key={m.id} m={m} upcoming />)}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="h-4 w-1 rounded bg-p-accent" />
                  <b className="font-display text-[29px] leading-none font-extrabold text-p-text">Прошедшие</b>
                  <span className="rounded-full bg-p-line/80 px-2.5 py-0.5 text-[10px] font-bold text-p-muted2">{past.length}</span>
                </div>
                <div className="space-y-2.5">
                  {past.map((m) => <MeetingCard key={m.id} m={m} />)}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}

const MeetingCard: React.FC<{ m: Meeting; upcoming?: boolean }> = ({ m, upcoming }) => (
  <div className="flex gap-4 rounded-panel border border-p-line bg-p-panel2 p-3.5 transition hover:border-p-accent-dim">
    <div className="h-[52px] w-[52px] shrink-0 rounded-ctl border border-p-line bg-p-panel text-center leading-none">
      <div className="pt-[7px] font-display text-[30px] font-black text-p-text">{dayNum(m.starts_at)}</div>
      <div className="-mt-0.5 text-[9px] uppercase tracking-wider text-p-muted2">{monthShort(m.starts_at)}</div>
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-bold text-p-text">{m.title}</div>
      <div className="mt-0.5 text-[11px] text-p-muted">
        {monthRu(m.starts_at)} · {weekday(m.starts_at)} · {timeRange(m.starts_at, m.ends_at)}
      </div>
      {m.description && <p className="mt-1 text-[11px] text-p-muted2">{m.description}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${statusTone(m.status)}`}>{statusLabel(m.status)}</span>
        {upcoming && m.meeting_link && (
          <a
            href={m.meeting_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-ctl bg-brand px-3 py-1.5 text-xs font-extrabold text-black hover:bg-brand-dark"
          >
            <Video className="w-3.5 h-3.5" /> Подключиться
          </a>
        )}
        {!upcoming && m.recording_url && (
          <a
            href={m.recording_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-ctl border border-brand/70 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Запись
          </a>
        )}
        {!upcoming && m.transcript_url && (
          <a
            href={m.transcript_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-ctl border border-brand/70 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
          >
            <FileText className="w-3.5 h-3.5" /> Транскрипт
          </a>
        )}
        {!upcoming && !m.recording_url && !m.transcript_url && (
          <span className="inline-flex items-center gap-1.5 rounded-ctl border border-p-line px-3 py-1.5 text-[11px] font-semibold text-p-muted">
            <Clock3 className="h-3.5 w-3.5" /> Материалы появятся позже
          </span>
        )}
      </div>
    </div>
  </div>
)
