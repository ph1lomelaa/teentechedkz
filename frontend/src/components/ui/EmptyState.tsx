import React from 'react'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppCard } from './AppCard'

type ColorPrefix = 'ds' | 'p' | 'w'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  colorPrefix?: ColorPrefix
}

const ICON_BOX_CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-accent-dim/25 bg-ds-accent/[0.06] text-ds-accent',
  p: 'border-p-accent-dim/25 bg-p-accent/[0.06] text-p-accent',
  w: 'border-w-accentDim/25 bg-w-accent/[0.06] text-w-accentText',
}

const TITLE_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-ink',
  p: 'text-p-text',
  w: 'text-w-ink',
}

const TEXT_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-muted',
  p: 'text-p-muted',
  w: 'text-w-muted',
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
  colorPrefix = 'ds',
}) => {
  return (
    <AppCard colorPrefix={colorPrefix} className={cn('px-8 py-10 text-center', className)}>
      <div className={cn('mx-auto grid h-16 w-16 place-items-center rounded-pill border', ICON_BOX_CLASS[colorPrefix])}>
        {icon || <Users className="h-6 w-6" />}
      </div>
      <div className={cn('mt-5 font-display text-lg font-black', TITLE_CLASS[colorPrefix])}>{title}</div>
      {description && <div className={cn('mx-auto mt-2 max-w-md text-sm', TEXT_CLASS[colorPrefix])}>{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </AppCard>
  )
}
