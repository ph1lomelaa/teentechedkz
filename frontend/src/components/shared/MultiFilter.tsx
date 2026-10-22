import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface FilterOption { value: string; label: string; count?: number }
export const csvValues = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean)

/** Empty selection means all; each checkbox is OR, different fields are AND. */
export function MultiFilter({ label, value, onChange, options }: {
  label: string; value: string[]; onChange: (values: string[]) => void; options: FilterOption[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  const selected = value.map(id => options.find(option => option.value === id)?.label ?? id)
  const visible = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <div ref={root} className="relative">
    <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}
      className={`flex min-h-9 max-w-64 items-center gap-2 rounded-ctl border px-3 text-left text-xs ${value.length ? 'border-p-accent-dim bg-p-chip text-p-chip-text' : 'border-p-line bg-p-panel text-p-text'}`}>
      <span className="truncate">{label}{value.length ? `: ${value.length === 1 ? selected[0] : value.length}` : ': все'}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
    </button>
    {open && <div role="dialog" aria-label={`Фильтр: ${label}`} className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-panel border border-p-line bg-p-panel p-3 text-p-text shadow-lg">
      <input aria-label={`Поиск: ${label}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти значение…" className="mb-2 h-9 w-full rounded-ctl border border-p-line bg-p-bg px-2 text-sm" />
      <div className="mb-2 flex justify-between gap-2 text-xs"><button type="button" className="underline" onClick={() => onChange([...new Set([...value, ...visible.map(option => option.value)])])}>Выбрать все</button><button type="button" className="underline" onClick={() => onChange([])}>Очистить</button></div>
      <div className="max-h-60 space-y-1 overflow-y-auto">
        {visible.map(option => <label key={option.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-ctl px-1 text-sm hover:bg-p-panel2">
          <input type="checkbox" aria-label={`${label}: ${option.label}`} checked={value.includes(option.value)} onChange={() => onChange(value.includes(option.value) ? value.filter(id => id !== option.value) : [...value, option.value])} />
          <span className="min-w-0 flex-1">{option.label}</span>{option.count != null && <span className="text-xs tabular-nums text-p-muted">{option.count}</span>}
        </label>)}
        {!visible.length && <p className="py-3 text-sm text-p-muted">Значения не найдены</p>}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-p-line pt-2"><span className="text-xs text-p-muted">{value.length ? `Выбрано: ${value.length}` : 'Все значения'}</span><button type="button" onClick={() => setOpen(false)} className="rounded-ctl bg-p-accent px-3 py-1.5 text-xs font-semibold text-black">Готово</button></div>
    </div>}
  </div>
}
