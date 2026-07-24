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
  onClick?: () => void
  valueClassName?: string
  valueTitle?: string
}

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub, warn, className, colorPrefix = 'ds', onClick, valueClassName, valueTitle }) => {
  // Динамически выбираем токены в зависимости от контекста
  const bgClass = colorPrefix === 'p' ? 'bg-p-panel' : colorPrefix === 'w' ? 'bg-w-panel' : 'bg-ds-panel'
  const borderClass = colorPrefix === 'p' ? 'border-p-line' : colorPrefix === 'w' ? 'border-w-line' : 'border-ds-line'
  const accentDimClass = colorPrefix === 'p' ? 'hover:border-p-accent-dim' : colorPrefix === 'w' ? 'hover:border-w-accentDim' : 'hover:border-ds-accent-dim'
  const mutedClass = colorPrefix === 'p' ? 'text-p-muted' : colorPrefix === 'w' ? 'text-w-muted' : 'text-ds-muted'
  const accentClass = colorPrefix === 'p' ? 'text-p-accent' : colorPrefix === 'w' ? 'text-w-accent' : 'text-ds-accent'
  const goodClass = colorPrefix === 'p' ? 'text-p-good' : colorPrefix === 'w' ? 'text-w-good' : 'text-ds-good'
  const Comp = onClick ? 'button' : 'div'

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        `relative overflow-hidden rounded-card border ${borderClass} ${bgClass} p-5 text-left transition hover:-translate-y-0.5 ${accentDimClass}`,
        onClick && 'cursor-pointer w-full',
        className
      )}
    >
      <div className={`flex items-center gap-2 text-2xs tracking-wide ${mutedClass}`}>
        {icon && <div className={accentClass}>{icon}</div>}
        {label}
      </div>
      <div className={cn('mt-2.5 truncate font-display text-4xl font-black leading-none', valueClassName)} title={valueTitle ?? value}>{value}</div>
      {sub && (
        <div className={cn('mt-1 text-xs', warn ? accentClass : goodClass)}>
          {sub}
        </div>
      )}
      <div className="pointer-events-none absolute -bottom-3.5 -right-3.5 select-none font-display text-[88px] font-black leading-none text-current opacity-[0.03]">
        {value}
      </div>
    </Comp>
  )
}
