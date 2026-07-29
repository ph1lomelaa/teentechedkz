import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  colorPrefix?: ColorPrefix
  className?: string
}

const EYEBROW_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-accent',
  p: 'text-p-accent',
  w: 'text-w-accentText',
}

const TITLE_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-ink',
  p: 'text-p-text',
  w: 'text-w-ink',
}

const DESCRIPTION_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-muted',
  p: 'text-p-muted',
  w: 'text-w-muted',
}

// One canonical heading pattern for every surface (workspace/portal/CRM),
// replacing WorkspacePageHeader, CrmPageHeader and portal pages' ad-hoc inline
// headers — same eyebrow/title/description/action shape, same type scale.
export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  action,
  colorPrefix = 'ds',
  className,
}) => (
  <div className={cn('mb-6 flex flex-col items-stretch gap-4 sm:mb-7 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-5', className)}>
    <div className="min-w-0 flex-1">
      {eyebrow && (
        <div className={cn('mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em]', EYEBROW_CLASS[colorPrefix])}>
          {eyebrow}
        </div>
      )}
      <h1 className={cn('break-words font-display text-[1.75rem] font-black leading-[1.08] tracking-tight sm:text-3xl md:text-4xl', TITLE_CLASS[colorPrefix])}>
        {title}
      </h1>
      {description && (
        <div className={cn('mt-2 max-w-[560px] text-sm leading-6', DESCRIPTION_CLASS[colorPrefix])}>{description}</div>
      )}
    </div>
    {action && <div className="min-w-0 sm:shrink-0 [&>*]:max-w-full">{action}</div>}
  </div>
)
