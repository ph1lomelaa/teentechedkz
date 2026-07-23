import React from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  icon?: React.ReactNode
  label: string
  value: string
  sub?: string
  warn?: boolean
  className?: string
  colorPrefix?: 'ds' | 'p' | 'w'  // Выбор набора токенов
}

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub, warn, className, colorPrefix = 'ds' }) => {
  // Динамически выбираем токены в зависимости от контекста
  const bgClass = colorPrefix === 'p' ? 'bg-p-panel' : colorPrefix === 'w' ? 'bg-w-panel' : 'bg-ds-panel'
  const borderClass = colorPrefix === 'p' ? 'border-p-line' : colorPrefix === 'w' ? 'border-w-line' : 'border-ds-line'
  const accentDimClass = colorPrefix === 'p' ? 'hover:border-p-accent-dim' : colorPrefix === 'w' ? 'hover:border-w-accentDim' : 'hover:border-ds-accent-dim'
  const mutedClass = colorPrefix === 'p' ? 'text-p-muted' : colorPrefix === 'w' ? 'text-w-muted' : 'text-ds-muted'
  const accentClass = colorPrefix === 'p' ? 'text-p-accent' : colorPrefix === 'w' ? 'text-w-accent' : 'text-ds-accent'
  const goodClass = colorPrefix === 'p' ? 'text-p-good' : colorPrefix === 'w' ? 'text-w-good' : 'text-ds-good'

  return (
    <div
      className={cn(
        `relative overflow-hidden rounded-card border ${borderClass} ${bgClass} p-5 transition hover:-translate-y-0.5 ${accentDimClass}`,
        className
      )}
    >
      <div className={`flex items-center gap-2 text-[11px] tracking-wide ${mutedClass}`}>
        {icon && <div className={accentClass}>{icon}</div>}
        {label}
      </div>
      <div className="mt-2.5 font-display text-4xl font-black leading-none">{value}</div>
      {sub && (
        <div className={cn('mt-1 text-xs', warn ? accentClass : goodClass)}>
          {sub}
        </div>
      )}
      <div className="pointer-events-none absolute -bottom-3.5 -right-3.5 select-none font-display text-[88px] font-black leading-none text-white opacity-[0.03]">
        {value}
      </div>
    </div>
  )
}
