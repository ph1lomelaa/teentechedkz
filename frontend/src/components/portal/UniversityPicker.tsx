import React, { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { universitiesApi } from '@/api/universities'
import { matchesUniversityQuery } from '@/lib/university-search'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'

/** Pick a university out of the full catalog.
 *
 * 200 rows filter fast enough to render without virtualization — the catalog
 * page already does exactly this. Uses the shared search predicate so a
 * university findable in the catalog is findable here too.
 */
export const UniversityPicker: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Already-shortlisted university ids — shown disabled rather than hidden,
   *  so the user understands why a search hit isn't selectable. */
  excludeIds?: string[]
  onPick: (universityId: string) => void
  isPending?: boolean
}> = ({ open, onOpenChange, excludeIds = [], onPick, isPending = false }) => {
  const [q, setQ] = useState('')
  const deferredQ = useDeferredValue(q)
  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ['universities'],
    queryFn: universitiesApi.list,
    enabled: open,
  })

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])
  const filtered = useMemo(
    () =>
      catalog
        .filter((u) => matchesUniversityQuery(u, deferredQ))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .slice(0, 60),
    [catalog, deferredQ]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Добавить университет</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Название, город, страна или специальность…"
            className="h-11 w-full rounded-ctl border border-p-line bg-p-panel2 pl-4 pr-11 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim"
          />
          <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
        </div>

        <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-ctl border border-p-line">
          {isLoading ? (
            <p className="p-4 text-sm text-p-muted">Загрузка…</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-p-muted">Ничего не найдено.</p>
          ) : (
            <ul className="divide-y divide-p-line">
              {filtered.map((u) => {
                const already = excluded.has(u.id)
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      disabled={already || isPending}
                      onClick={() => onPick(u.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-p-panel2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {u.photo_url ? (
                        <img src={u.photo_url} alt="" className="h-9 w-9 flex-none rounded-ctl object-cover" loading="lazy" />
                      ) : (
                        <span className="grid h-9 w-9 flex-none place-items-center rounded-ctl bg-p-panel2 text-sm">
                          {u.country_flag_emoji || '🎓'}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-p-text">{u.name}</span>
                        <span className="block truncate text-xs text-p-muted">
                          {[u.country_name, u.city].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {already && (
                        <span className="flex flex-none items-center gap-1 text-[11px] font-bold text-p-muted2">
                          <Check className="h-3.5 w-3.5" />
                          уже добавлен
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
