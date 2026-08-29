import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

const SURFACE_CLASS: Record<ColorPrefix, string> = {
  ds: 'bg-ds-panel2',
  p: 'bg-p-panel2',
  w: 'bg-w-panel2',
}

/** Плейсхолдер формы будущего контента. Пульсация отключается вместе с
 *  остальной анимацией, если человек попросил её убрать в системе. */
export const Skeleton: React.FC<{ className?: string; colorPrefix?: ColorPrefix }> = ({
  className,
  colorPrefix = 'ds',
}) => (
  <div
    aria-hidden="true"
    className={cn('rounded-panel motion-safe:animate-pulse', SURFACE_CLASS[colorPrefix], className)}
  />
)

/** Ходовой случай: список одинаковых строк. */
export const SkeletonRows: React.FC<{
  rows?: number
  className?: string
  colorPrefix?: ColorPrefix
}> = ({ rows = 4, className, colorPrefix = 'ds' }) => (
  <div className="space-y-2.5">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} colorPrefix={colorPrefix} className={cn('h-16 w-full', className)} />
    ))}
  </div>
)
