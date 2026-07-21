import React, { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Meeting } from '@/api/meetings'
import { cn } from '@/lib/utils'

// Month calendar of meetings (donor MonthCalendar.vue): Mon–Sun grid, meeting
// chips on desktop, yellow dots on mobile, prev/next month nav. p-* tokens so it
// renders in the portal (and would render in the workspace shell too).
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const
const MONTH_FMT = new Intl.DateTimeFormat('ru-RU', { month: 'long' })

function toLocalISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

interface DayCell {
  iso: string
  day: number
  inMonth: boolean
  isToday: boolean
  meetings: Meeting[]
}

export const PortalMonthCalendar: React.FC<{ meetings: Meeting[] }> = ({ meetings }) => {
  const [current, setCurrent] = useState(() => new Date())
  const [selected, setSelected] = useState<string | null>(null)

  const label = useMemo(() => {
    const name = MONTH_FMT.format(current)
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${current.getFullYear()}`
  }, [current])

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const m of meetings) {
      const iso = toLocalISO(new Date(m.starts_at))
      const arr = map.get(iso)
      if (arr) arr.push(m)
      else map.set(iso, [m])
    }
    for (const arr of map.values()) arr.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return map
  }, [meetings])

  const cells = useMemo<DayCell[]>(() => {
    const year = current.getFullYear()
    const month = current.getMonth()
    const first = new Date(year, month, 1)
    const offset = (first.getDay() + 6) % 7 // shift so week starts on Monday
    const todayIso = toLocalISO(new Date())
    const out: DayCell[] = []
    for (let i = 0; i < 42; i++) {
      const dt = new Date(year, month, 1 - offset + i)
      const iso = toLocalISO(dt)
      out.push({
        iso,
        day: dt.getDate(),
        inMonth: dt.getMonth() === month,
        isToday: iso === todayIso,
        meetings: meetingsByDay.get(iso) ?? [],
      })
    }
    return out
  }, [current, meetingsByDay])

  const prevMonth = () => setCurrent((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
  const nextMonth = () => setCurrent((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))

  return (
    <div className="rounded-[16px] border border-p-line bg-p-panel p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Предыдущий месяц"
          className="grid h-9 w-9 flex-none place-items-center rounded-[11px] border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-p-text"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="font-display text-base font-black tracking-tight text-p-text sm:text-lg">{label}</div>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Следующий месяц"
          className="grid h-9 w-9 flex-none place-items-center rounded-[11px] border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-p-text"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="pb-2 text-center text-[10px] font-bold uppercase tracking-widest text-p-muted2">
            {wd}
          </div>
        ))}

        {cells.map((c) => (
          <button
            key={c.iso}
            type="button"
            onClick={() => setSelected(c.iso)}
            aria-label={`День ${c.iso}`}
            className={cn(
              'flex min-h-[48px] flex-col items-center gap-1 rounded-lg border p-1 transition-colors sm:min-h-[84px] sm:items-stretch sm:p-1.5',
              selected === c.iso ? 'border-brand-dim bg-p-panel2' : 'border-transparent hover:border-brand-dim hover:bg-p-panel2'
            )}
          >
            <span
              className={cn(
                'grid h-6 w-6 flex-none place-items-center self-center rounded-full text-xs font-bold sm:self-start',
                c.isToday ? 'text-brand ring-2 ring-brand' : c.inMonth ? 'text-p-text' : 'text-p-muted2'
              )}
            >
              {c.day}
            </span>

            {c.meetings.length > 0 && (
              <span className="hidden w-full min-w-0 flex-col gap-1 sm:flex">
                {c.meetings.slice(0, 2).map((m) => (
                  <span
                    key={m.id}
                    title={m.title}
                    className="block w-full truncate rounded-md bg-brand/15 px-1.5 py-0.5 text-left text-[10px] font-bold leading-4 text-brand"
                  >
                    {fmtTime(m.starts_at)} {m.title}
                  </span>
                ))}
                {c.meetings.length > 2 && (
                  <span className="px-1.5 text-left text-[10px] font-bold text-p-muted">+{c.meetings.length - 2}</span>
                )}
              </span>
            )}

            {c.meetings.length > 0 && (
              <span className="flex gap-1 sm:hidden">
                {Array.from({ length: Math.min(c.meetings.length, 3) }).map((_, i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full bg-brand" />
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
