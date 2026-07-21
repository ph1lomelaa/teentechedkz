import React, { useMemo, useDeferredValue, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Edit2, Globe, Plus, Route, Search, X } from 'lucide-react'
import { countriesApi } from '@/api/index'
import { roadmapApi, RoadmapTemplate, TemplateListItem } from '@/api/roadmap'
import type { Country } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import {
  WorkspaceButton,
  WorkspaceEmptyState,
} from '@/components/workspace/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLocalState } from '@/lib/use-local-state'

export const WorkspaceCountriesPage: React.FC = () => {
  const { hasRole } = useAuth()
  const canEdit = hasRole('admin', 'mzk_manager')
  const [search, setSearch] = useLocalState('workspace:countries:search', '')
  const [degreeFilter, setDegreeFilter] = useLocalState<'all' | 'undergraduate' | 'graduate'>('workspace:countries:degree', 'all')
  const [editing, setEditing] = React.useState<Country | null | undefined>(undefined)
  const [roadmapSelection, setRoadmapSelection] = React.useState<{ country: Country; degree: 'undergraduate' | 'graduate'; template?: TemplateListItem } | null>(null)
  const { data: countries = [], isLoading } = useQuery({ queryKey: ['countries'], queryFn: countriesApi.list })
  const { data: templates = [] } = useQuery({ queryKey: ['roadmap-templates'], queryFn: roadmapApi.listTemplates })
  const deferredSearch = useDeferredValue(search)

  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return countries.filter((country) => {
      const matchesDegree = degreeFilter === 'all' || (country.degree_levels ?? ['undergraduate', 'graduate']).includes(degreeFilter)
      const matchesSearch = !q
        || country.country_name.toLowerCase().includes(q)
        || country.notes?.toLowerCase().includes(q)
        || country.submission_deadline_notes?.toLowerCase().includes(q)
      return matchesDegree && matchesSearch
    }).sort((a, b) => a.country_name.localeCompare(b.country_name, 'ru'))
  }, [countries, degreeFilter, deferredSearch])

  const openRoadmap = (country: Country, degree: 'undergraduate' | 'graduate') => {
    const expectedDegree = degree === 'graduate' ? 'masters' : 'bachelors'
    const template = templates.find((item) =>
      item.country_name?.toLocaleLowerCase('ru') === country.country_name.toLocaleLowerCase('ru')
      && item.degree === expectedDegree
    )
    setRoadmapSelection({ country, degree, template })
  }

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">База знаний</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Страны</h1>
          <p className="mt-2 max-w-[560px] text-sm text-p-muted">Требования, дедлайны, примечания и шаблоны roadmap для UG и Graduate.</p>
        </div>
        {canEdit && <WorkspaceButton onClick={() => setEditing(null)}><Plus className="h-4 w-4" />Добавить страну</WorkspaceButton>}
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск страны, дедлайна или примечания…" className="h-11 w-full rounded-[11px] border border-p-line bg-p-panel2 pl-10 pr-10 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand-dim" />
          {search && <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-p-muted2 hover:text-p-text"><X className="h-4 w-4" /></button>}
        </div>
        <div className="flex rounded-full border border-p-line bg-p-panel p-1">
          {([
            ['all', 'Все'],
            ['undergraduate', 'UG'],
            ['graduate', 'Graduate'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setDegreeFilter(value)} className={`rounded-full px-4 py-2 text-xs font-black transition ${degreeFilter === value ? 'bg-brand text-black' : 'text-p-muted hover:text-p-text'}`}>{label}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-[20px] border border-p-line bg-p-panel p-5 text-sm text-p-muted">Загрузка стран...</div>
      ) : visible.length === 0 ? (
        <WorkspaceEmptyState icon={<Globe className="h-5 w-5" />} title="Страны не найдены" text="Измените поиск или добавьте новую страну." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((country) => (
            <article key={country.id} className="relative overflow-hidden rounded-[20px] border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-[22px] transition-colors hover:border-brand-dim">
              {country.flag_url && <div className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-cover bg-center opacity-[0.14] [filter:grayscale(0.2)]" style={{ backgroundImage: `url('${country.flag_url}')` }} aria-hidden="true" />}
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
                    {canEdit && <button type="button" aria-label={`Редактировать ${country.country_name}`} onClick={() => setEditing(country)} className="grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-brand"><Edit2 className="h-4 w-4" /></button>}
                    {(country.degree_levels ?? ['undergraduate', 'graduate']).includes('undergraduate') && (
                      <button type="button" onClick={() => openRoadmap(country, 'undergraduate')} className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-3 py-1.5 text-[10.5px] font-black text-black transition hover:bg-brand-dark">UG<ChevronRight className="h-3 w-3" /></button>
                    )}
                    {(country.degree_levels ?? ['undergraduate', 'graduate']).includes('graduate') && (
                      <button type="button" onClick={() => openRoadmap(country, 'graduate')} className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-3 py-1.5 text-[10.5px] font-black text-black transition hover:bg-brand-dark">Graduate<ChevronRight className="h-3 w-3" /></button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing !== undefined && <CountryDialog country={editing || undefined} onClose={() => setEditing(undefined)} />}
      {roadmapSelection && <RoadmapPreview selection={roadmapSelection} onClose={() => setRoadmapSelection(null)} />}
    </div>
  )
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Route className="h-5 w-5 text-brand" />{selection.country.country_name} · {selection.degree === 'graduate' ? 'Graduate' : 'UG'}</DialogTitle></DialogHeader>
        {!selection.template ? (
          <div className="rounded-[16px] border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">Для этого направления roadmap-шаблон пока не добавлен.</div>
        ) : isLoading || !template ? (
          <div className="p-6 text-sm text-p-muted">Загрузка roadmap...</div>
        ) : <TemplateStages template={template} />}
      </DialogContent>
    </Dialog>
  )
}

function TemplateStages({ template }: { template: RoadmapTemplate }) {
  return <div className="space-y-3">
    {template.description && <p className="text-sm leading-6 text-p-muted">{template.description}</p>}
    {template.stages.map((stage, index) => (
      <section key={stage.id} className="rounded-[16px] border border-p-line bg-p-panel2 p-4">
        <div className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-black text-black">{index + 1}</span><h3 className="font-black text-p-text">{stage.name}</h3></div>
        {stage.description && <p className="ml-10 mt-1 text-xs text-p-muted">{stage.description}</p>}
        <div className="ml-10 mt-3 space-y-2">{stage.tasks.map((task) => <div key={task.id} className="flex items-start gap-2 text-sm text-p-muted"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /><span>{task.title}</span></div>)}</div>
      </section>
    ))}
  </div>
}

function CountryDialog({ country, onClose }: { country?: Country; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    country_name: country?.country_name || '',
    vpp_required: country?.vpp_required || false,
    submission_deadline_notes: country?.submission_deadline_notes || '',
    notes: country?.notes || '',
    degree_levels: country?.degree_levels ?? ['undergraduate', 'graduate'],
  })
  const mutation = useMutation({
    mutationFn: () => country ? countriesApi.update(country.id, form) : countriesApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['countries'] })
      toast({ title: country ? 'Страна обновлена' : 'Страна добавлена' })
      onClose()
    },
    onError: () => toast({ title: 'Не удалось сохранить страну', variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{country ? 'Редактировать страну' : 'Добавить страну'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input value={form.country_name} onChange={(event) => setForm({ ...form, country_name: event.target.value })} placeholder="Название страны" className="w-full rounded-[10px] border border-gray-300 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.vpp_required} onChange={(event) => setForm({ ...form, vpp_required: event.target.checked })} />Требуется VPP / УП</label>
          <fieldset className="rounded-[12px] border border-gray-300 p-3">
            <legend className="px-1 text-xs font-bold text-gray-600">Уровни поступления</legend>
            <div className="flex flex-wrap gap-4">
              {([
                ['undergraduate', 'UG / Бакалавриат'],
                ['graduate', 'Graduate / Магистратура'],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.degree_levels.includes(value)} onChange={(event) => setForm({ ...form, degree_levels: event.target.checked ? [...form.degree_levels, value] : form.degree_levels.filter((item: string) => item !== value) })} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <input value={form.submission_deadline_notes} onChange={(event) => setForm({ ...form, submission_deadline_notes: event.target.value })} placeholder="Дедлайн подач" className="w-full rounded-[10px] border border-gray-300 px-3 py-2 text-sm" />
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Примечания" className="min-h-28 w-full rounded-[10px] border border-gray-300 px-3 py-2 text-sm" />
          <div className="flex justify-end gap-2"><WorkspaceButton variant="ghost" onClick={onClose}>Отмена</WorkspaceButton><WorkspaceButton disabled={!form.country_name.trim() || form.degree_levels.length === 0 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Сохраняем...' : 'Сохранить'}</WorkspaceButton></div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
