import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Globe, Plus, RefreshCw, Search } from 'lucide-react'
import { UniversityFormDialog } from './UniversityFormDialog'
import { universitiesApi, University, DegreeLevel } from '@/api/universities'
import { useLocalState } from '@/lib/use-local-state'
import { matchesUniversityQuery } from '@/lib/university-search'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'

export const DEGREE_LABELS: Record<DegreeLevel, string> = {
  undergraduate: 'Бакалавриат',
  masters: 'Магистратура',
  doctorate: 'Докторантура',
}

export const UniversitiesCatalog: React.FC<{
  eyebrow?: string
  basePath?: string
  /** Reveals catalog-management affordances. Off by default so the portal and
   *  workspace catalogs stay read-only. */
  canManage?: boolean
  /** The backend import endpoint is admin-only, even though MЗК can edit rows. */
  canImport?: boolean
}> = ({ eyebrow = 'База знаний', basePath = '/portal/universities', canManage = false, canImport = false }) => {
  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ['universities'],
    queryFn: universitiesApi.list,
  })
  const queryClient = useQueryClient()
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const importMutation = useMutation({
    mutationFn: () => universitiesApi.startImport(false),
    onSuccess: (job) => { setImportJobId(job.id); setImportMessage(null) },
    onError: (error: unknown) => {
      const response = (error as { response?: { data?: { detail?: string | { message?: string; job_id?: string } } } }).response
      const detail = response?.data?.detail
      if (detail && typeof detail === 'object') {
        if (detail.job_id) setImportJobId(detail.job_id)
        setImportMessage(detail.message || 'Импорт уже запущен.')
      } else {
        setImportMessage(typeof detail === 'string' ? detail : 'Не удалось запустить импорт.')
      }
    },
  })
  const { data: importJob } = useQuery({
    queryKey: ['universities', 'import', importJobId],
    queryFn: () => universitiesApi.getImportJob(importJobId as string),
    enabled: canImport && Boolean(importJobId),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 1500 : false,
  })

  useEffect(() => {
    if (importJob?.status === 'done') queryClient.invalidateQueries({ queryKey: ['universities'] })
  }, [importJob?.status, queryClient])

  const [q, setQ] = useLocalState('portal:universities:search', '')
  const [countryFilter, setCountryFilter] = useLocalState('portal:universities:country', 'all')
  // Multi-select, matching the "Степени" checkbox filter on teenteched.com.
  // Empty array = no degree restriction.
  const [degreeFilters, setDegreeFilters] = useLocalState<DegreeLevel[]>('portal:universities:degrees', [])
  const [grantsOnly, setGrantsOnly] = useLocalState('portal:universities:grants-only', false)
  const [formOpen, setFormOpen] = useState(false)
  const deferredQ = useDeferredValue(q)

  const countries = useMemo(() => {
    const seen = new Map<string, { name: string; emoji: string; count: number }>()
    for (const u of catalog) {
      if (!u.country_name) continue
      const existing = seen.get(u.country_name)
      if (existing) existing.count += 1
      else seen.set(u.country_name, { name: u.country_name, emoji: u.country_flag_emoji || '', count: 1 })
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [catalog])

  const degreeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const u of catalog) {
      for (const d of u.degree_levels || []) counts[d] = (counts[d] || 0) + 1
    }
    return counts
  }, [catalog])

  const toggleDegree = (degree: DegreeLevel) => {
    setDegreeFilters(
      degreeFilters.includes(degree)
        ? degreeFilters.filter((d) => d !== degree)
        : [...degreeFilters, degree]
    )
  }

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase()
    const result = catalog.filter((u) => {
      if (countryFilter !== 'all' && (u.country_name || '') !== countryFilter) return false
      // Several degrees checked = "any of these", as on the site.
      if (degreeFilters.length > 0) {
        const levels = u.degree_levels || []
        if (!degreeFilters.some((d) => levels.includes(d))) return false
      }
      // Only confirmed grants — "unknown" must not pass as a positive.
      if (grantsOnly && (u.has_grants_status ?? (u.has_grants ? 'yes' : 'unknown')) !== 'yes') return false
      if (!matchesUniversityQuery(u, needle)) return false
      return true
    })
    return result.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [catalog, countryFilter, degreeFilters, deferredQ, grantsOnly])

  const hasActiveFilters =
    countryFilter !== 'all' || degreeFilters.length > 0 || grantsOnly || q.trim() !== ''

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">{eyebrow}</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Университеты</h1>
          <p className="mt-2 max-w-[480px] text-sm text-p-muted">
            Каталог вузов: рейтинги, стоимость обучения и доступные гранты по странам.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {canImport && <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex h-10 flex-none items-center gap-2 rounded-ctl bg-brand px-4 text-sm font-bold text-black"
            >
              <Plus className="h-4 w-4" />
              Добавить университет
            </button>}
            <button
              type="button"
              disabled={importMutation.isPending || importJob?.status === 'running'}
              onClick={() => importMutation.mutate()}
              className="inline-flex h-10 flex-none items-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-4 text-sm font-bold text-p-text transition hover:border-brand-dim disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${importJob?.status === 'running' ? 'animate-spin' : ''}`} />
              {importJob?.status === 'running' ? 'Импорт идёт…' : 'Импортировать каталог'}
            </button>
          </div>
        )}
      </div>

      {canImport && (importMessage || importJob?.status === 'failed' || importJob?.status === 'done') && (
        <div className={`mb-5 rounded-card border px-4 py-3 text-sm ${importJob?.status === 'failed' || importMutation.isError ? 'border-red-400/30 bg-red-400/10 text-red-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`}>
          {importMessage}
          {importJob?.status === 'failed' && `Импорт не выполнен: ${importJob.error || 'неизвестная ошибка'}`}
          {importJob?.status === 'done' && importJob.result && `Импорт завершён: создано ${importJob.result.created}, обновлено ${importJob.result.updated}, сопоставлено ${importJob.result.matched}.`}
        </div>
      )}

      {canManage && <UniversityFormDialog open={formOpen} onOpenChange={setFormOpen} />}

      <div className="relative mb-6 w-full">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию, городу, стране или специальности…"
          className="h-12 w-full rounded-ctl border border-p-line bg-p-panel2 pl-4 pr-12 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim"
        />
        <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-p-muted2" />
      </div>

      {/* Filter shape mirrors teenteched.com: country as a select with counts
          (16 countries as buttons wrapped onto three rows), degree as
          multi-select checkboxes. */}
      <div className="mb-5 flex flex-col gap-4 rounded-card border border-p-line bg-p-panel p-4 sm:flex-row sm:items-end sm:gap-6">
        <label className="flex min-w-0 flex-col gap-1.5 sm:w-64">
          <span className="text-[10px] font-black uppercase tracking-widest text-p-muted2">Страна</span>
          {/* Radix Select вместо нативного <select>: на macOS/Safari системный
              список игнорирует color-scheme страницы и рисуется в светлой
              теме ОС независимо от темы приложения. Свой листбокс всегда
              тёмный, потому что рисует его не система, а мы. */}
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="h-10 w-full border-p-line bg-p-panel2 text-sm font-bold text-p-text focus:border-brand-dim">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-p-line bg-p-panel text-p-text">
              <SelectItem value="all">Все страны ({catalog.length})</SelectItem>
              {countries.map((country) => (
                <SelectItem key={country.name} value={country.name}>
                  {country.emoji ? `${country.emoji} ` : ''}{country.name} ({country.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <fieldset className="min-w-0 flex-1">
          <legend className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-p-muted2">
            Степень
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(['undergraduate', 'masters', 'doctorate'] as const).map((degree) => (
              <label
                key={degree}
                className="flex cursor-pointer select-none items-center gap-2 text-[13px] font-bold text-p-muted transition-colors hover:text-p-text"
              >
                <input
                  type="checkbox"
                  checked={degreeFilters.includes(degree)}
                  onChange={() => toggleDegree(degree)}
                  className="h-4 w-4 flex-none accent-brand"
                />
                <span className={degreeFilters.includes(degree) ? 'text-p-text' : undefined}>
                  {DEGREE_LABELS[degree]}
                  <span className="ml-1 font-normal text-p-muted2">({degreeCounts[degree] || 0})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          onClick={() => setGrantsOnly(!grantsOnly)}
          className={`h-10 flex-none rounded-ctl border px-3.5 text-xs font-bold transition ${grantsOnly ? 'border-p-good bg-p-good/15 text-p-good' : 'border-p-line bg-p-panel2 text-p-muted hover:text-p-text'}`}
        >
          Только с грантами
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-card border border-p-line bg-p-panel" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-p-line bg-p-panel p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-panel bg-brand/15">
            <Globe className="h-5 w-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Ничего не найдено</h2>
          <p className="mt-1.5 text-sm text-p-muted">
            Попробуйте изменить поисковый запрос или фильтры.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setCountryFilter('all')
                setDegreeFilters([])
                setGrantsOnly(false)
                setQ('')
              }}
              className="mt-3 text-sm font-bold text-brand hover:underline"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3 text-xs text-p-muted2">
            <span>Найдено: {filtered.length}</span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setCountryFilter('all')
                  setDegreeFilters([])
                  setGrantsOnly(false)
                  setQ('')
                }}
                className="font-bold text-p-muted underline transition-colors hover:text-p-text"
              >
                Сбросить фильтры
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((u) => (
              <UniversityCard key={u.id} u={u} basePath={basePath} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const UniversityCard: React.FC<{ u: University; basePath: string }> = ({ u, basePath }) => {
  const grants = u.has_grants_status ?? (u.has_grants ? 'yes' : 'unknown')
  const faculties = u.faculties || []
  // Only render the footer when it would actually say something — previously
  // it always led with "Обучение: —", which was empty on most of the catalog.
  const showFooter = Boolean(u.tuition_range) || grants !== 'no' || Boolean(u.website)

  return (
    <article className="relative overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg transition-colors hover:border-brand-dim">
      {/* Пропорция вместо фиксированной высоты: панорамные снимки кампусов при
          h-32 обрезались в узкую ленту, а 16/9 масштабируется вместе с шириной
          карточки и держит кадр на любом брейкпоинте. */}
      {u.photo_url ? (
        <div className="aspect-[16/9] w-full overflow-hidden">
          <img src={u.photo_url} alt={u.name} className="h-full w-full object-cover" loading="lazy" />
        </div>
      ) : u.country_flag_url && (
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-cover bg-center opacity-[0.14] [filter:grayscale(0.2)]"
          style={{ backgroundImage: `url('${u.country_flag_url}')` }}
          aria-hidden="true"
        />
      )}
      <div className="relative p-[22px]">
        {/* The whole body links to the detail page; the website link below is a
            sibling, never nested — an <a> inside an <a> is invalid and would
            swallow the click. */}
        <Link to={`${basePath}/${u.id}`} className="block outline-none focus-visible:underline">
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

          {(u.degree_levels || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(u.degree_levels || []).map((d) => (
                <span key={d} className="rounded-full bg-p-panel2 px-2 py-0.5 text-[10px] font-bold text-p-muted">
                  {DEGREE_LABELS[d]}
                </span>
              ))}
            </div>
          )}

          {faculties.length > 0 ? (
            <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-p-muted">
              <span className="font-bold text-p-text">Направления: </span>
              {faculties.slice(0, 4).join(' · ')}
              {faculties.length > 4 ? ` и ещё ${faculties.length - 4}` : ''}
            </p>
          ) : u.description ? (
            <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-p-muted">{u.description}</p>
          ) : null}
        </Link>

        {showFooter && (
          <div className="mt-4 flex items-center gap-3 border-t border-p-line pt-3.5">
            {u.tuition_range && (
              <div className="min-w-0">
                <span className="block text-[10px] uppercase tracking-widest text-p-muted2">Обучение</span>
                <b className="block truncate text-[12.5px] font-bold text-p-text">{u.tuition_range}</b>
              </div>
            )}
            {grants === 'yes' && (
              <span className="whitespace-nowrap rounded-full bg-p-good/15 px-3 py-1 text-[10.5px] font-bold text-p-good">
                Гранты
              </span>
            )}
            {grants === 'unknown' && (
              <span className="whitespace-nowrap rounded-full bg-p-panel2 px-3 py-1 text-[10.5px] font-bold text-p-muted2">
                Гранты — нет данных
              </span>
            )}
            {u.website && (
              <a
                href={u.website}
                target="_blank"
                rel="noreferrer"
                title="Открыть сайт университета"
                aria-label={`Сайт университета ${u.name}`}
                className="ml-auto grid h-9 w-9 flex-none place-items-center rounded-ctl border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-brand"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
