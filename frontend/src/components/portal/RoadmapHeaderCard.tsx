import React from 'react'
import { Roadmap } from '@/api/roadmap'
import { cn } from '@/lib/utils'

// Плавный count-up числа (для процента прогресса): анимирует от предыдущего
// значения к новому через rAF; при prefers-reduced-motion показывает сразу.
export function useCountUp(target: number, durationMs = 600): number {
  const [shown, setShown] = React.useState(target)
  const fromRef = React.useRef(target)
  React.useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target
      setShown(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setShown(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return shown
}

// Donor-style roadmap header card (.rm-card): gradient panel, semi-transparent
// country flag watermark, year/country/degree pills, 4 Archivo metrics and a
// yellow progress bar. Uses p-* tokens, which are defined under `.portal` — so it
// renders correctly in both the student portal and the staff workspace (whose
// root carries the `.portal` class).
function counts(rm: Roadmap) {
  let total = 0
  let done = 0 // истина ментора: status='done' = подтверждено
  let pending = 0 // заявки студента на проверке
  for (const s of rm.stages) for (const t of s.tasks) {
    total += 1
    if (t.status === 'done') done += 1
    else if (t.review_status === 'pending') pending += 1
  }
  // Одна правда с дорожкой этапов: «заполнено» = done + pending,
  // метрика «выполнено» продолжает считать только подтверждённое ментором.
  const pct = total ? Math.round(((done + pending) / total) * 100) : 0
  return { total, done, pending, pct, stages: rm.stages.length }
}

export const RoadmapHeaderCard: React.FC<{ roadmap: Roadmap; className?: string }> = ({ roadmap, className }) => {
  const { total, done, pending, pct, stages } = counts(roadmap)
  const shownPct = useCountUp(pct)
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-6',
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
        <span className="ml-auto rounded-full border border-p-line bg-p-panel2 px-3 py-1 text-[11px] font-bold text-p-muted">
          {roadmap.mentor_name ? `Ментор: ${roadmap.mentor_name}` : 'Ментор не назначен'}
        </span>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <Metric value={String(stages)} label="этапов" />
        <Metric value={String(total)} label="задач" />
        <Metric value={String(done)} label="выполнено" />
        {pending > 0 && <Metric value={String(pending)} label="на проверке" />}
        <Metric value={`${shownPct}%`} label="прогресс" />
      </div>

      <div className="relative mt-[18px] h-2 overflow-hidden rounded-full bg-p-panel2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-dim to-brand transition-[width] duration-700 ease-out motion-reduce:transition-none"
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
