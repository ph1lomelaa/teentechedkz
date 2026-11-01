import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'

/** Поиск в шапке раздела «Финансы»: по ученику — ведёт в список договоров
 * со всеми статусами, чтобы не потерять договор на возврате или паузе. */
export function FinanceHeaderSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const value = q.trim()
        if (value) navigate(`/finance/contracts?status=all&q=${encodeURIComponent(value)}`)
      }}
      className="relative w-full max-w-[360px]"
    >
      <label htmlFor="fin-header-search" className="sr-only">Поиск по ученику и договору</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        id="fin-header-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по ученику и договору"
        className="h-[38px] w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black/40 focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </form>
  )
}
