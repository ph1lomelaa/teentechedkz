import React, { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Globe, Search, ChevronRight, Route } from 'lucide-react'
import { countriesApi } from '@/api/index'
import { useLocalState } from '@/lib/use-local-state'
import { roadmapApi, RoadmapTemplate, TemplateListItem } from '@/api/roadmap'
import type { Country } from '@/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'

export const PortalCountriesCatalog: React.FC = () => {
  const { data: countries = [], isLoading } = useQuery({
    queryKey: ['portal', 'countries'],
    queryFn: countriesApi.list,
  })

  const { data: templates = [] } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
  })

  const [q, setQ] = useLocalState('portal:countries:search', '')
  const [degreeFilter, setDegreeFilter] = useLocalState<'all' | 'undergraduate' | 'graduate'>('portal:countries:degree', 'all')
  const [roadmapSelection, setRoadmapSelection] = useState<{ country: Country; degree: 'undergraduate' | 'graduate'; template?: TemplateListItem } | null>(null)
  const deferredQ = useDeferredValue(q)

  const visible = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase()
    const result = countries.filter((country) => {
      const matchesDegree = degreeFilter === 'all' || (country.degree_levels ?? ['undergraduate', 'graduate']).includes(degreeFilter)
      if (!matchesDegree) return false
      if (needle) {
        const hay = `${country.country_name} ${country.notes || ''} ${country.submission_deadline_notes || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    return result.sort((a, b) => a.country_name.localeCompare(b.country_name, 'ru'))
  }, [countries, deferredQ, degreeFilter])

  const openRoadmap = (country: Country, degree: 'undergraduate' | 'graduate') => {
    const expectedDegree = degree === 'graduate' ? 'masters' : 'bachelors'
    const template = templates.find((item) =>
      item.country_name?.toLocaleLowerCase('ru') === country.country_name.toLocaleLowerCase('ru')
      && item.degree === expectedDegree
    )
    setRoadmapSelection({ country, degree, template })
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Справочник</p>
        <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Страны</h1>
        <p className="mt-2 max-w-[480px] text-sm text-p-muted">
          Требования к поступлению, дедлайны и особенности поступления по странам.
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="relative flex-1 min-w-0">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по стране или дедлайну…"
            className="h-12 w-full rounded-ctl border border-p-line bg-p-panel2 pl-4 pr-12 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim"
          />
          <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-p-muted2" />
        </div>

        <div className="flex shrink-0 rounded-full border border-p-line bg-p-panel p-1">
          {(['all', 'undergraduate', 'graduate'] as const).map((value) => {
            const labels: Record<typeof value, string> = {
              all: 'Все',
              undergraduate: 'Бакалавриат',
              graduate: 'Магистратура',
            }
            return (
              <button
                key={value}
                type="button"
                onClick={() => setDegreeFilter(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${degreeFilter === value ? 'bg-brand text-black' : 'text-p-muted hover:text-p-text'}`}
              >
                {labels[value]}
              </button>
            )
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-card border border-p-line bg-p-panel" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-card border border-p-line bg-p-panel p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-panel bg-brand/15">
            <Globe className="h-5 w-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Страны не найдены</h2>
          <p className="mt-1.5 text-sm text-p-muted">
            Попробуйте изменить поисковый запрос или фильтр.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((country) => (
            <CountryCard key={country.id} country={country} onOpenRoadmap={openRoadmap} />
          ))}
        </div>
      )}

      {roadmapSelection && <RoadmapPreview selection={roadmapSelection} onClose={() => setRoadmapSelection(null)} />}
    </div>
  )
}

interface CountryCardProps {
  country: Country
  onOpenRoadmap: (country: Country, degree: 'undergraduate' | 'graduate') => void
}

function RoadmapPreview({ selection, onClose }: { selection: { country: Country; degree: 'undergraduate' | 'graduate'; template?: TemplateListItem }; onClose: () => void }) {
  const { data: template, isLoading } = useQuery({
    queryKey: ['roadmap-template', selection.template?.id],
    queryFn: () => roadmapApi.getTemplate(selection.template!.id),
    enabled: Boolean(selection.template),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="portal max-h-[85vh] max-w-2xl overflow-y-auto border-p-line bg-p-panel text-p-text">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="h-5 w-5 text-brand" />
            {selection.country.country_name} · {selection.degree === 'graduate' ? 'Graduate' : 'UG'}
          </DialogTitle>
        </DialogHeader>
        {!selection.template ? (
          <div className="rounded-card border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">
            Для этого направления roadmap-шаблон пока не добавлен.
          </div>
        ) : isLoading || !template ? (
          <div className="p-6 text-sm text-p-muted">Загрузка roadmap...</div>
        ) : (
          <TemplateStages template={template} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function TemplateStages({ template }: { template: RoadmapTemplate }) {
  return (
    <div className="space-y-3">
      {template.description && <p className="text-sm leading-6 text-p-muted">{template.description}</p>}
      {template.stages.map((stage, index) => (
        <section key={stage.id} className="rounded-panel border border-p-line bg-p-panel2 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-black text-black">
              {index + 1}
            </span>
            <h3 className="font-black text-p-text">{stage.name}</h3>
          </div>
          {stage.description && <p className="ml-10 mt-1 text-xs text-p-muted">{stage.description}</p>}
          <div className="ml-10 mt-3 space-y-2">
            {stage.tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-2 text-sm text-p-muted">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span>{task.title}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const CountryCard: React.FC<CountryCardProps> = ({ country, onOpenRoadmap }) => (
  <article className="relative overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-[22px] transition-colors hover:border-brand-dim">
    {country.flag_url && (
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-cover bg-center opacity-[0.14] [filter:grayscale(0.2)]"
        style={{ backgroundImage: `url('${country.flag_url}')` }}
        aria-hidden="true"
      />
    )}
    <div className="relative">
      <h3 className="font-display text-xl font-extrabold leading-snug text-p-text">{country.country_name}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-p-muted">
          {country.flag_emoji ? `${country.flag_emoji} ` : ''}{country.country_name}
        </span>
      </div>

      {country.submission_deadline_notes && (
        <p className="mt-3 line-clamp-2 min-h-[38px] text-[12.5px] leading-relaxed text-p-muted">{country.submission_deadline_notes}</p>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-p-line pt-3.5">
        <div className="min-w-0">
          <span className="block text-[10px] uppercase tracking-widest text-p-muted2">Примечания</span>
          <b className="block truncate text-[12.5px] font-bold text-p-text">{country.notes || '—'}</b>
        </div>
        {country.vpp_required && (
          <span className="whitespace-nowrap rounded-full bg-brand/15 px-3 py-1 text-[10.5px] font-bold text-brand">
            VPP требуется
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {(country.degree_levels ?? ['undergraduate', 'graduate']).includes('undergraduate') && (
            <button
              type="button"
              onClick={() => onOpenRoadmap(country, 'undergraduate')}
              className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-3 py-1.5 text-[10.5px] font-black text-black transition hover:bg-brand-dark"
            >
              UG
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
          {(country.degree_levels ?? ['undergraduate', 'graduate']).includes('graduate') && (
            <button
              type="button"
              onClick={() => onOpenRoadmap(country, 'graduate')}
              className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-3 py-1.5 text-[10.5px] font-black text-black transition hover:bg-brand-dark"
            >
              Graduate
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  </article>
)
