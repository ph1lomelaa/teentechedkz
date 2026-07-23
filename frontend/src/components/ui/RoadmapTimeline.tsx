import React from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle2 } from 'lucide-react'

export interface TimelineStage {
  id: string
  name: string
  status: 'done' | 'in_progress' | 'planned'
  number?: number
  label?: string // "готово" / "сейчас" / "скоро"
}

interface RoadmapTimelineProps {
  stages: TimelineStage[]
  onStageSelect?: (stageId: string) => void
  selectedStageId?: string
  colorPrefix?: 'p' | 'w'
  className?: string
}

export const RoadmapTimeline: React.FC<RoadmapTimelineProps> = ({
  stages,
  onStageSelect,
  selectedStageId,
  colorPrefix = 'p',
  className,
}) => {
  const accentClass = colorPrefix === 'p' ? 'bg-p-accent' : 'bg-w-accent'
  const textClass = colorPrefix === 'p' ? 'text-p-text' : 'text-w-ink'
  const lineClass = colorPrefix === 'p' ? 'bg-p-line' : 'bg-w-line'
  const doneStatusBg = colorPrefix === 'p' ? 'bg-p-accent' : 'bg-w-accent'
  const inProgressBorder = colorPrefix === 'p' ? 'border-2 border-p-accent' : 'border-2 border-w-accent'

  return (
    <div className={cn('overflow-x-auto py-6', className)}>
      <div className="flex items-center gap-2 px-[22px] min-w-max">
        {/* Connection line with progress fill */}
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 bg-gradient-to-r" style={{
          width: stages.length > 0 ? `${((stages.findIndex(s => s.status === 'in_progress' || s.status === 'done') + 1) / stages.length) * 100}%` : '0%',
          backgroundImage: colorPrefix === 'p' 
            ? 'linear-gradient(to right, var(--p-accent-dim), var(--p-accent))'
            : 'linear-gradient(to right, var(--w-accent-dim), var(--w-accent))'
        }} />

        {/* Stages */}
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1
          const isDone = stage.status === 'done'
          const isInProgress = stage.status === 'in_progress'
          const isPlanned = stage.status === 'planned'

          return (
            <React.Fragment key={stage.id}>
              {/* Node */}
              <button
                onClick={() => onStageSelect?.(stage.id)}
                className={cn(
                  'relative flex-none transition focus-visible:outline-none',
                  selectedStageId === stage.id ? 'scale-110' : 'hover:scale-105'
                )}
              >
                <div
                  className={cn(
                    'flex h-[46px] w-[46px] items-center justify-center rounded-full font-black text-[13px] transition',
                    isDone && doneStatusBg + ' text-black',
                    isInProgress && 'border-[3px] bg-black ' + inProgressBorder,
                    isPlanned && `border-2 ${lineClass} bg-black`
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 size={20} className="text-black" />
                  ) : (
                    <span className={cn(
                      'font-black',
                      isDone ? 'text-black' : isInProgress ? 'text-p-accent' : textClass
                    )}>
                      {stage.number || index + 1}
                    </span>
                  )}
                </div>

                {/* Label below node */}
                {stage.label && (
                  <div className={cn('mt-2 text-center text-[11px] font-bold whitespace-nowrap', textClass)}>
                    {stage.label}
                  </div>
                )}

                {/* Stage name */}
                <div className={cn(
                  'absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold',
                  textClass
                )}>
                  {stage.name}
                </div>
              </button>

              {/* Connection line between nodes */}
              {!isLast && (
                <div className={cn(
                  'h-1 w-8 flex-none rounded-full',
                  index < stages.findIndex(s => s.status === 'in_progress' || s.status === 'done') + 1
                    ? accentClass
                    : lineClass
                )} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Stage names at bottom */}
      <div className="mt-12 flex justify-between px-[22px]">
        {stages.map((stage) => (
          <div key={stage.id} className={cn('text-[11px] font-bold text-center', textClass)}>
            {stage.label}
          </div>
        ))}
      </div>
    </div>
  )
}
