import React, { useDeferredValue, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Globe, Search } from 'lucide-react'
import { universitiesApi, University } from '@/api/universities'
import { useLocalState } from '@/lib/use-local-state'

export const UniversitiesCatalog: React.FC<{ eyebrow?: string }> = ({ eyebrow = 'База знаний' }) => {
  const { data: unis = [], isLoading } = useQuery({
    queryKey: ['universities'],
    queryFn: universitiesApi.list,
  })

  const [q, setQ] = useLocalState('portal:universities:search', '')
  const deferredQ = useDeferredValue(q)

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase()
    const result = unis.filter((u) => {
      if (needle) {
        const hay = `${u.name} ${u.city} ${u.country_name || ''} ${u.description || ''} ${u.tuition_range || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    return result.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [unis, deferredQ])

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">{eyebrow}</p>
        <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Университеты</h1>
        <p className="mt-2 max-w-[480px] text-sm text-p-muted">
          Каталог вузов: рейтинги, стоимость обучения и доступные гранты по странам.
        </p>
      </div>

      <div className="relative mb-6 w-full">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию, городу или стране…"
          className="h-12 w-full rounded-[13px] border border-p-line bg-p-panel2 pl-4 pr-12 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim"
        />
        <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-p-muted2" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-[20px] border border-p-line bg-p-panel" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-[13px] bg-brand/15">
            <Globe className="h-5 w-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Ничего не найдено</h2>
          <p className="mt-1.5 text-sm text-p-muted">
            Попробуйте изменить поисковый запрос.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 text-xs text-p-muted2">Найдено: {filtered.length}</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((u) => (
              <UniversityCard key={u.id} u={u} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const UniversityCard: React.FC<{ u: University }> = ({ u }) => (
  <article className="relative overflow-hidden rounded-[20px] border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-[22px] transition-colors hover:border-brand-dim">
    {u.country_flag_url && (
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-cover bg-center opacity-[0.14] [filter:grayscale(0.2)]"
        style={{ backgroundImage: `url('${u.country_flag_url}')` }}
        aria-hidden="true"
      />
    )}
    <div className="relative">
      <h3 className="font-display text-xl font-extrabold leading-snug text-p-text">{u.name}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-p-muted">
          {u.country_flag_emoji ? `${u.country_flag_emoji} ` : ''}{[u.country_name, u.city].filter(Boolean).join(' · ')}
        </span>
        {u.world_ranking != null && (
          <span className="whitespace-nowrap rounded-full border border-p-line bg-p-panel2 px-2.5 py-0.5 text-[10.5px] font-bold text-brand">
            #{u.world_ranking} в мире
          </span>
        )}
      </div>

      {u.description && (
        <p className="mt-3 line-clamp-2 min-h-[38px] text-[12.5px] leading-relaxed text-p-muted">{u.description}</p>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-p-line pt-3.5">
        <div className="min-w-0">
          <span className="block text-[10px] uppercase tracking-widest text-p-muted2">Обучение</span>
          <b className="block truncate text-[12.5px] font-bold text-p-text">{u.tuition_range || '—'}</b>
        </div>
        {u.has_grants && (
          <span className="whitespace-nowrap rounded-full bg-p-good/15 px-3 py-1 text-[10.5px] font-bold text-p-good">
            Гранты
          </span>
        )}
        {u.website && (
          <a
            href={u.website}
            target="_blank"
            rel="noreferrer"
            title="Открыть сайт университета"
            aria-label={`Сайт университета ${u.name}`}
            className="ml-auto grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-brand"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  </article>
)
