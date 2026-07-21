import { cn } from '@/lib/utils'

export function WorkspaceSegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full overflow-x-auto rounded-[13px] border border-w-line bg-w-panel p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'shrink-0 rounded-[10px] px-3.5 py-2 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accentDim',
            value === option.value
              ? 'bg-w-accent text-black'
              : 'text-w-muted hover:bg-w-panel2 hover:text-w-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
