import React from 'react'
import { cn } from '@/lib/utils'

interface SegmentedTab {
  value: string
  label: React.ReactNode
}

interface SegmentedTabsProps {
  tabs: SegmentedTab[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export const SegmentedTabs: React.FC<SegmentedTabsProps> = ({ tabs, value, onChange, className }) => {
  return (
    <div className={cn('inline-flex rounded-xl border border-ds-line bg-ds-panel p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-lg px-4 py-2 text-[12.5px] font-bold transition-colors',
            value === tab.value
              ? 'bg-ds-accent text-black'
              : 'text-ds-muted hover:text-ds-ink'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
