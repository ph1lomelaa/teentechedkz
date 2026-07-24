import React from 'react'
import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number // 0-100
  colorPrefix?: 'p' | 'w' | 'ds'
  showLabel?: boolean
  className?: string
  label?: string
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  colorPrefix = 'p',
  showLabel = true,
  className,
  label = 'Прогресс',
}) => {
  const barBgClass = colorPrefix === 'p' 
    ? 'bg-p-panel' 
    : colorPrefix === 'w' 
    ? 'bg-w-panel' 
    : 'bg-ds-panel'

  const progressClass = colorPrefix === 'p'
    ? 'bg-gradient-to-r from-p-accent-dim to-p-accent'
    : colorPrefix === 'w'
    ? 'bg-gradient-to-r from-w-accentDim to-w-accent'
    : 'bg-gradient-to-r from-ds-accent-dim to-ds-accent'

  const clampedValue = Math.min(Math.max(value, 0), 100)

  return (
    <div className={cn('w-full', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedValue}
        className={cn('h-2 overflow-hidden rounded-full', barBgClass)}
      >
        <div
          className={cn('h-full transition-all duration-500', progressClass)}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-right text-2xs font-bold opacity-70">
          {clampedValue}%
        </div>
      )}
    </div>
  )
}
