import React, { useDeferredValue, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Globe, Search } from 'lucide-react'
import { universitiesApi, University } from '@/api/universities'
import { useLocalState } from '@/lib/use-local-state'

type UniversityPreset = University

const CATALOG_COUNTRIES = [
  { key: 'all', label: 'Все', emoji: '' },
  { key: 'Великобритания', label: 'Великобритания', emoji: '🇬🇧' },
  { key: 'Германия', label: 'Германия', emoji: '🇩🇪' },
  { key: 'Китай', label: 'Китай', emoji: '🇨🇳' },
  { key: 'Малайзия', label: 'Малайзия', emoji: '🇲🇾' },
  { key: 'США', label: 'США', emoji: '🇺🇸' },
  { key: 'Южная Корея', label: 'Южная Корея', emoji: '🇰🇷' },
] as const

const COUNTRY_FLAG_BY_NAME: Record<string, string> = {
  'Великобритания': '🇬🇧',
  'Германия': '🇩🇪',
  'Китай': '🇨🇳',
  'Малайзия': '🇲🇾',
  'США': '🇺🇸',
  'Южная Корея': '🇰🇷',
}

function resolveCountryFlag(u: University): string {
  if (u.country_flag_emoji && u.country_flag_emoji.trim()) return u.country_flag_emoji
  const byName = (u.country_name && COUNTRY_FLAG_BY_NAME[u.country_name]) || ''
  return byName
}

const PRESET_UNIVERSITIES: UniversityPreset[] = [
  {
    id: 'preset-tsinghua',
    country_ref_id: null,
    country_name: 'Китай',
    country_flag_emoji: '🇨🇳',
    country_flag_url: '',
    name: 'Tsinghua University',
    city: 'Пекин',
    description: 'Ведущий технический вуз Китая, сильные инженерные и CS-программы.',
    website: 'https://www.tsinghua.edu.cn',
    world_ranking: 12,
    tuition_range: '$4 000–6 000/год',
    has_grants: true,
  },
  {
    id: 'preset-peking',
    country_ref_id: null,
    country_name: 'Китай',
    country_flag_emoji: '🇨🇳',
    country_flag_url: '',
    name: 'Peking University',
    city: 'Пекин',
    description: 'Топ-университет Китая по естественным и гуманитарным наукам.',
    website: 'https://www.pku.edu.cn',
    world_ranking: 14,
    tuition_range: '$4 000–6 000/год',
    has_grants: true,
  },
  {
    id: 'preset-tum',
    country_ref_id: null,
    country_name: 'Германия',
    country_flag_emoji: '🇩🇪',
    country_flag_url: '',
    name: 'Technical University of Munich',
    city: 'Мюнхен',
    description: 'Ведущий технический вуз Германии; обучение почти бесплатное.',
    website: 'https://www.tum.de',
    world_ranking: 28,
    tuition_range: '€0–3 000/год',
    has_grants: true,
  },
  {
    id: 'preset-snu',
    country_ref_id: null,
    country_name: 'Южная Корея',
    country_flag_emoji: '🇰🇷',
    country_flag_url: '',
    name: 'Seoul National University',
    city: 'Сеул',
    description: 'Флагманский университет Кореи.',
    website: 'https://en.snu.ac.kr',
    world_ranking: 31,
    tuition_range: '$2 500–6 000/год',
    has_grants: true,
  },
  {
    id: 'preset-zhejiang',
    country_ref_id: null,
    country_name: 'Китай',
    country_flag_emoji: '🇨🇳',
    country_flag_url: '',
    name: 'Zhejiang University',
    city: 'Ханчжоу',
    description: 'Один из крупнейших исследовательских вузов, щедрые стипендии CSC.',
    website: 'https://www.zju.edu.cn',
    world_ranking: 44,
    tuition_range: '$3 000–5 000/год',
    has_grants: true,
  },
  {
    id: 'preset-sjtu',
    country_ref_id: null,
    country_name: 'Китай',
    country_flag_emoji: '🇨🇳',
    country_flag_url: '',
    name: 'Shanghai Jiao Tong University',
    city: 'Шанхай',
    description: 'Инженерия, медицина, бизнес; активные программы для иностранцев.',
    website: 'https://www.sjtu.edu.cn',
    world_ranking: 45,
    tuition_range: '$3 500–5 500/год',
    has_grants: true,
  },
  {
    id: 'preset-kaist',
    country_ref_id: null,
    country_name: 'Южная Корея',
    country_flag_emoji: '🇰🇷',
    country_flag_url: '',
    name: 'KAIST',
    city: 'Тэджон',
    description: 'Ведущий научно-технический вуз, полные стипендии для иностранцев.',
    website: 'https://www.kaist.ac.kr',
    world_ranking: 53,
    tuition_range: 'полная стипендия',
    has_grants: true,
  },
  {
    id: 'preset-yonsei',
    country_ref_id: null,
    country_name: 'Южная Корея',
    country_flag_emoji: '🇰🇷',
    country_flag_url: '',
    name: 'Yonsei University',
    city: 'Сеул',
    description: 'Частный топ-вуз, программы Global Leaders.',
    website: 'https://www.yonsei.ac.kr',
    world_ranking: 76,
    tuition_range: '$5 000–9 000/год',
    has_grants: true,
  },
  {
    id: 'preset-heidelberg',
    country_ref_id: null,
    country_name: 'Германия',
    country_flag_emoji: '🇩🇪',
    country_flag_url: '',
    name: 'Heidelberg University',
    city: 'Гейдельберг',
    description: 'Старейший университет Германии, сильные науки о жизни.',
    website: 'https://www.uni-heidelberg.de',
    world_ranking: 84,
    tuition_range: '€0–1 500/год',
    has_grants: true,
  },
  {
    id: 'preset-rwth',
    country_ref_id: null,
    country_name: 'Германия',
    country_flag_emoji: '🇩🇪',
    country_flag_url: '',
    name: 'RWTH Aachen University',
    city: 'Ахен',
    description: 'Крупнейший технический университет Германии.',
    website: 'https://www.rwth-aachen.de',
    world_ranking: 90,
    tuition_range: '€0–1 000/год',
    has_grants: true,
  },
]

function mergeWithPresets(universities: University[]): University[] {
  const existingKeys = new Set(
    universities.map((u) => `${(u.name || '').trim().toLowerCase()}::${(u.country_name || '').trim().toLowerCase()}`),
  )
  const extras = PRESET_UNIVERSITIES.filter(
    (u) => !existingKeys.has(`${u.name.trim().toLowerCase()}::${(u.country_name || '').trim().toLowerCase()}`),
  )
  return [...universities, ...extras]
}

export const UniversitiesCatalog: React.FC<{ eyebrow?: string }> = ({ eyebrow = 'База знаний' }) => {
  const { data: unis = [], isLoading } = useQuery({
    queryKey: ['universities'],
    queryFn: universitiesApi.list,
  })

  const [q, setQ] = useLocalState('portal:universities:search', '')
  const [countryFilter, setCountryFilter] = useLocalState('portal:universities:country', 'all')
  const [grantsOnly, setGrantsOnly] = useLocalState('portal:universities:grants-only', false)
  const deferredQ = useDeferredValue(q)
  const catalog = useMemo(() => mergeWithPresets(unis), [unis])

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase()
    const result = catalog.filter((u) => {
      if (countryFilter !== 'all' && (u.country_name || '') !== countryFilter) return false
      if (grantsOnly && !u.has_grants) return false
      if (needle) {
        const hay = `${u.name} ${u.city} ${u.country_name || ''} ${u.description || ''} ${u.tuition_range || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    return result.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [catalog, countryFilter, deferredQ, grantsOnly])

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
          className="h-12 w-full rounded-ctl border border-p-line bg-p-panel2 pl-4 pr-12 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim"
        />
        <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-p-muted2" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATALOG_COUNTRIES.map((country) => (
          <button
            key={country.key}
            type="button"
            onClick={() => setCountryFilter(country.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${countryFilter === country.key ? 'border-brand bg-brand text-black' : 'border-p-line bg-p-panel2 text-p-muted hover:text-p-text'}`}
          >
            {country.emoji ? `${country.emoji} ` : ''}
            {country.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setGrantsOnly(!grantsOnly)}
          className={`ml-auto rounded-full border px-3 py-1.5 text-xs font-bold transition ${grantsOnly ? 'border-p-good bg-p-good/15 text-p-good' : 'border-p-line bg-p-panel2 text-p-muted hover:text-p-text'}`}
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
  <article className="relative overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-[22px] transition-colors hover:border-brand-dim">
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
          {resolveCountryFlag(u) ? `${resolveCountryFlag(u)} ` : ''}{[u.country_name, u.city].filter(Boolean).join(' · ')}
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
            className="ml-auto grid h-9 w-9 flex-none place-items-center rounded-ctl border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-brand"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  </article>
)
