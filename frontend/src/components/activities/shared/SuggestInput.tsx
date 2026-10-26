import { useId, useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/primitives/input'
import { cn } from '@/lib/utils'

/** Поле с подсказками из уже введённых значений. Своё значение тоже можно ввести; вместо серого системного `<datalist>`. */
export function SuggestInput({ value, onChange, options, className, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'list'> & {
  value: string; onChange: (value: string) => void; options: string[]
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const needle = value.trim().toLocaleLowerCase('ru')
  const shown = options.filter((o) => o.toLocaleLowerCase('ru').includes(needle) && o !== value).slice(0, 8)
  const pick = (next: string) => { onChange(next); setOpen(false); setActive(-1) }
  return <div className="relative">
    <Input {...props} className={className} value={value} role="combobox" aria-expanded={open && shown.length > 0} aria-controls={listId} aria-autocomplete="list"
      onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (!shown.length) return
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % shown.length) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? shown.length - 1 : i - 1)) }
        else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); pick(shown[active]) }
        else if (e.key === 'Escape') setOpen(false)
      }} />
    {open && shown.length > 0 && <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-panel border border-ds-line bg-ds-panel p-1 text-sm font-normal shadow-lg">
      {shown.map((o, i) => <li key={o} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(o) }}
        className={cn('cursor-pointer rounded-ctl px-3 py-2', i === active ? 'bg-ds-panel2 text-ds-ink' : 'text-ds-ink hover:bg-ds-panel2')}>{o}</li>)}
    </ul>}
  </div>
}
