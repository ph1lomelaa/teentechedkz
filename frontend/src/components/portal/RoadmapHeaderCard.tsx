import React from 'react'
import { Roadmap } from '@/api/roadmap'
import { cn } from '@/lib/utils'

// Donor-style roadmap header card (.rm-card): gradient panel, semi-transparent
// country flag watermark, year/country/degree pills, 4 Archivo metrics and a
// yellow progress bar. Uses p-* tokens, which are defined under `.portal` — so it
// renders correctly in both the student portal and the staff workspace (whose
// root carries the `.portal` class).
function counts(rm: Roadmap) {
  let total = 0
  let done = 0
  for (const s of rm.stages) for (const t of s.tasks) {
    total += 1
    if (t.status === 'done') done += 1
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, stages: rm.stages.length }
}

export const RoadmapHeaderCard: React.FC<{ roadmap: Roadmap; className?: string }> = ({ roadmap, className }) => {
  const { total, done, pct, stages } = counts(roadmap)
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[20px] border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-6',
        className
      )}
    >
      {roadmap.country_flag_url ? (
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-56 w-56 rounded-full bg-cover bg-center opacity-[0.16] [filter:grayscale(0.2)]"
          style={{ backgroundImage: `url('${roadmap.country_flag_url}')` }}
          aria-hidden="true"
        />
      ) : (
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full opacity-[0.12]"
          style={{ background: 'radial-gradient(circle at 30% 30%, #FFD400, transparent 70%)' }}
          aria-hidden="true"
        />
      )}

      <div className="relative flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[24px] font-black leading-tight text-p-text">{roadmap.name}</h2>
        <span className="rounded-full border border-brand bg-brand px-3 py-1 text-[11px] font-bold text-black">
          {roadmap.year}
        </span>
        {roadmap.country_name && (
          <span className="rounded-full border border-p-line bg-p-panel2 px-3 py-1 text-[11px] font-bold text-p-muted">
            {roadmap.country_flag_emoji ? `${roadmap.country_flag_emoji} ` : ''}{roadmap.country_name}
          </span>
        )}
        <span className="rounded-full border border-p-line bg-p-panel2 px-3 py-1 text-[11px] font-bold text-p-muted">
          {roadmap.degree === 'masters' ? 'Магистратура' : 'Бакалавриат'}
        </span>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <Metric value={String(stages)} label="этапов" />
        <Metric value={String(total)} label="задач" />
        <Metric value={String(done)} label="выполнено" />
        <Metric value={`${pct}%`} label="прогресс" />
      </div>

      <div className="relative mt-[18px] h-2 overflow-hidden rounded-full bg-p-panel2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-dim to-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

const Metric: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div>
    <b className="font-display text-[20px] font-black text-brand tabular-nums">{value}</b>
    <small className="block text-[11px] tracking-[0.03em] text-p-muted">{label}</small>
  </div>
)
