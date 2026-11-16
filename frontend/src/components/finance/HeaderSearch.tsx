import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { financeApi } from '@/api/finance'
import { money } from './format'

/** Поиск в шапке раздела «Финансы»: часть ФИО, телефон или номер договора.
 * Результаты — выпадающим списком, по нажатию — карточка договора. Enter
 * без выбора открывает «Договоры» со всеми статусами и этим поиском. */
export function FinanceHeaderSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLFormElement>(null)
  useEffect(() => { const t = window.setTimeout(() => setDebounced(q.trim()), 250); return () => window.clearTimeout(t) }, [q])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['finance', 'search', debounced],
    queryFn: () => financeApi.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })
  const go = (contractId: string) => { setOpen(false); setQ(''); navigate(`/finance/contracts/${contractId}`) }
  const show = open && debounced.length >= 2

  return (
    <form
      ref={box}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (active >= 0 && hits[active]) return go(hits[active].contract_id)
        const value = q.trim()
        if (value) { setOpen(false); navigate(`/finance/contracts?q=${encodeURIComponent(value)}`) }
      }}
      className="relative w-full max-w-[420px]"
    >
      <label htmlFor="fin-header-search" className="sr-only">Поиск: ФИО, телефон или номер договора</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        id="fin-header-search"
        value={q}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls="fin-header-search-list"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)) }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="ФИО, телефон или номер договора"
        className="h-[38px] w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black/40 focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      {show && (
        <ul id="fin-header-search-list" role="listbox"
          className="absolute left-0 right-0 top-[42px] z-50 max-h-[360px] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{isFetching ? 'Ищем…' : 'Ничего не найдено'}</li>}
          {hits.map((h, i) => (
            <li key={h.contract_id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.contract_id)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 ${i === active ? 'bg-gray-50' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900">{h.student_name}</span>
                  <span className="block truncate text-xs text-gray-500">{[h.number && `№${h.number}`, h.phone, h.mzk_name && `МЗК ${h.mzk_name}`].filter(Boolean).join(' · ')}</span>
                </span>
                {h.remaining !== null && <span className="shrink-0 tabular-nums text-xs text-gray-600">остаток {money(h.remaining, h.currency)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
