import { useRef } from 'react'
import { KanbanSquare, Table2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PipelineView } from './viewState'

const TABS: { value: PipelineView; label: string; icon: LucideIcon }[] = [
  { value: 'board', label: 'Доска', icon: KanbanSquare },
  { value: 'table', label: 'Таблица', icon: Table2 },
]

/**
 * Вкладки вида, как в Notion: активная — жирная с жёлтым подчёркиванием.
 * Клавиатура по паттерну WAI-ARIA Tabs: стрелки переключают и переносят фокус,
 * Home/End — к крайним вкладкам, в порядке Tab участвует только активная.
 */
export function PipelineViewTabs({ value, onChange }: { value: PipelineView; onChange: (view: PipelineView) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const move = (index: number) => {
    const next = TABS[(index + TABS.length) % TABS.length]
    onChange(next.value)
    refs.current[next.value]?.focus()
  }
  return (
    <div role="tablist" aria-label="Вид пайплайна" className="flex gap-5 border-b border-p-line">
      {TABS.map((tab, index) => {
        const active = tab.value === value
        const Icon = tab.icon
        return (
          <button
            key={tab.value}
            ref={(node) => { refs.current[tab.value] = node }}
            type="button"
            role="tab"
            id={`pipeline-tab-${tab.value}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); move(index + 1) }
              else if (event.key === 'ArrowLeft') { event.preventDefault(); move(index - 1) }
              else if (event.key === 'Home') { event.preventDefault(); move(0) }
              else if (event.key === 'End') { event.preventDefault(); move(TABS.length - 1) }
            }}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 rounded-t-ctl border-b-2 px-0.5 pb-2 pt-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'border-p-accent font-semibold text-p-text' : 'border-transparent text-p-muted hover:text-p-text',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
