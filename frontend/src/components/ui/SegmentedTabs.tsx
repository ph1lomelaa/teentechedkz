import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

interface SegmentedTab {
  value: string
  label: React.ReactNode
}

interface SegmentedTabsProps {
  tabs: SegmentedTab[]
  value: string
  onChange: (value: string) => void
  className?: string
  colorPrefix?: ColorPrefix
}

const RAIL_CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-line bg-ds-panel',
  p: 'border-p-line bg-p-panel',
  w: 'border-w-line bg-w-panel',
}

const ACTIVE_CLASS: Record<ColorPrefix, string> = {
  ds: 'bg-ds-accent text-black focus-visible:ring-ds-accent-dim',
  p: 'bg-p-accent text-black focus-visible:ring-p-accent-dim',
  w: 'bg-w-accent text-black focus-visible:ring-w-accentDim',
}

const INACTIVE_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-muted hover:text-ds-ink',
  p: 'text-p-muted hover:text-p-text',
  w: 'text-w-muted hover:text-w-ink',
}

export const SegmentedTabs: React.FC<SegmentedTabsProps> = ({ tabs, value, onChange, className, colorPrefix = 'ds' }) => {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full overflow-x-auto rounded-panel border p-1', RAIL_CLASS[colorPrefix], className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'shrink-0 rounded-ctl px-4 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2',
            value === tab.value ? ACTIVE_CLASS[colorPrefix] : INACTIVE_CLASS[colorPrefix]
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
