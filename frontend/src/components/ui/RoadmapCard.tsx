import React from 'react'
import { cn } from '@/lib/utils'
import { Map, CheckCircle2, Trophy } from 'lucide-react'

interface RoadmapCardProps {
  title: string
  year: number
  country: string
  degree: string
  mentor?: { name: string; avatar?: string }
  student?: { name: string }
  countryFlag?: React.ReactNode
  stats: {
    stages: number
    tasks: number
    completed: number
    progress: number // 0-100
  }
  colorPrefix?: 'p' | 'w'
  className?: string
}

export const RoadmapCard: React.FC<RoadmapCardProps> = ({
  title,
  year,
  country,
  degree,
  mentor,
  student,
  countryFlag,
  stats,
  colorPrefix = 'p',
  className,
}) => {
  const bgClass = colorPrefix === 'p' ? 'from-[#161616] to-[#111111]' : 'from-[#0a1a2e] to-[#050f1a]'
  const textClass = colorPrefix === 'p' ? 'text-p-text' : 'text-w-ink'
  const accentClass = colorPrefix === 'p' ? 'text-p-accent' : 'text-w-accent'
  const barBgClass = colorPrefix === 'p' ? 'bg-p-panel' : 'bg-w-panel'
  const chipBgClass = colorPrefix === 'p' ? 'bg-p-accent/15 text-p-accent' : 'bg-w-accent/15 text-w-accent'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-card border border-opacity-20 bg-gradient-to-br p-[22px]',
        bgClass,
        'border-p-line',
        className
      )}
    >
      {/* Country flag watermark in background */}
      {countryFlag && (
        <div className="absolute -right-8 -top-8 text-[120px] opacity-[0.08]">
          {countryFlag}
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        {/* Header: Title + Year Badge */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className={cn('text-lg font-black', accentClass)}>
              {title}
            </h3>
            <p className={cn('text-[11px] font-bold uppercase tracking-wider opacity-60', textClass)}>
              {year} · {country}
            </p>
          </div>
          <div className={cn('whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold', chipBgClass)}>
            {year}
          </div>
        </div>

        {/* Meta chips */}
        <div className="mb-5 flex flex-wrap gap-2">
          <div className={cn('rounded-full px-3 py-1.5 text-[11px] font-bold', chipBgClass)}>
            {degree}
          </div>
          {mentor && (
            <div className={cn('rounded-full px-3 py-1.5 text-[11px] font-bold', chipBgClass)}>
              Ментор: {mentor.name}
            </div>
          )}
          {student && (
            <div className={cn('rounded-full px-3 py-1.5 text-[11px] font-bold opacity-60', chipBgClass)}>
              {student.name}
            </div>
          )}
        </div>

        {/* Stats grid: 4 blocks */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Stages */}
          <div className={cn('rounded-[11px] border border-opacity-30 bg-opacity-30 p-3', barBgClass)}>
            <div className="flex items-center gap-1.5">
              <Trophy size={16} className={accentClass} />
              <span className={cn('text-[11px] font-bold opacity-70', textClass)}>Этапов</span>
            </div>
            <div className={cn('mt-2 text-2xl font-black', accentClass)}>
              {stats.stages}
            </div>
          </div>

          {/* Total Tasks */}
          <div className={cn('rounded-[11px] border border-opacity-30 bg-opacity-30 p-3', barBgClass)}>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className={accentClass} />
              <span className={cn('text-[11px] font-bold opacity-70', textClass)}>Всего</span>
            </div>
            <div className={cn('mt-2 text-2xl font-black', accentClass)}>
              {stats.tasks}
            </div>
          </div>

          {/* Completed */}
          <div className={cn('rounded-[11px] border border-opacity-30 bg-opacity-30 p-3', barBgClass)}>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-green-500" />
              <span className={cn('text-[11px] font-bold opacity-70', textClass)}>Готово</span>
            </div>
            <div className={cn('mt-2 text-2xl font-black text-green-500')}>
              {stats.completed}
            </div>
          </div>

          {/* Progress % */}
          <div className={cn('rounded-[11px] border border-opacity-30 bg-opacity-30 p-3', barBgClass)}>
            <div className="flex items-center gap-1.5">
              <Map size={16} className={accentClass} />
              <span className={cn('text-[11px] font-bold opacity-70', textClass)}>Прогресс</span>
            </div>
            <div className={cn('mt-2 text-2xl font-black', accentClass)}>
              {stats.progress}%
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className={cn('h-2 overflow-hidden rounded-full', barBgClass)}>
          <div
            className={cn(
              'h-full bg-gradient-to-r transition-all duration-500',
              colorPrefix === 'p'
                ? 'from-p-accent-dim to-p-accent'
                : 'from-w-accentDim to-w-accent'
            )}
            style={{ width: `${stats.progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
