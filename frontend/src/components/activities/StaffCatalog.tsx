import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Pencil, Check, X } from 'lucide-react'
import { activitiesApi, type Activity, type ExperienceKey, type Intake } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { dateSummary, isExperienceKey, matchesCatalogFilter, PUBLICATION, type CatalogFilter } from '@/lib/activityUi'
import { getErrorMessage } from '@/lib/errorMessage'
import { DirectionBadge, ExperienceChips, FilterChip, PublicationStatus } from './ActivityParts'
import { ActivityCatalogCard } from './ActivityCards'
import { activityInput } from './ActivityDataForm'

type Field = 'title' | 'direction' | 'publication' | 'deadline'
function InlineCell({ activity, field, editable, children, catalog }: { activity: Activity; field: Field; editable: boolean; children: React.ReactNode; catalog: Activity[] }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(field === 'deadline' ? activity.next_intake?.deadline ?? '' : activity[field] ?? '')
  const client = useQueryClient()
  const save = useMutation({ mutationFn: async () => {
    if (field === 'deadline') {
      const i = activity.next_intake!
      const body: Omit<Intake, 'id' | 'activity_id'> = { label: i.label, mode: value ? 'fixed' : 'unknown', deadline: value || null, dates_text: i.dates_text, format: i.format, cost_state: i.cost_state, cost_text: i.cost_text }
      return activitiesApi.updateIntake(activity.id, i.id, body)
    }
    return activitiesApi.save({ ...activityInput(activity), [field]: value || null }, activity.id)
  }, onSuccess: () => { setEditing(false); client.invalidateQueries({ queryKey: ['activities'] }) } })
  const allowed = editable && (field !== 'deadline' || !!activity.next_intake)
  return <div onClick={e => editing && e.stopPropagation()}>
    {editing ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); e.stopPropagation(); save.mutate() }}>
      {field === 'publication' ? <select aria-label="Статус публикации" className="w-full rounded-ctl border border-ds-line bg-ds-panel p-2 text-sm" value={value} onChange={e => setValue(e.target.value)}>{Object.entries(PUBLICATION).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select> : <Input autoFocus aria-label={field === 'title' ? 'Название активности' : field === 'direction' ? 'Направление активности' : 'Срок организатора'} type={field === 'deadline' ? 'date' : 'text'} required={field === 'title'} list={field === 'direction' ? 'catalog-directions' : undefined} value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }} />}
      {field === 'direction' && <datalist id="catalog-directions">{[...new Set(catalog.map(a => a.direction).filter(Boolean))].map(d => <option key={d} value={d!} />)}</datalist>}
      <div className="flex gap-2"><button type="submit" aria-label="Сохранить ячейку" disabled={save.isPending} className="rounded-ctl border border-ds-line p-1.5"><Check className="h-4 w-4" /></button><button type="button" aria-label="Отменить редактирование" onClick={() => setEditing(false)} className="rounded-ctl p-1.5"><X className="h-4 w-4" /></button></div>
      {save.isError && <p role="alert" className="text-xs text-ds-danger">{getErrorMessage(save.error)}</p>}
    </form> : <div className="group/cell flex items-start gap-2"><div className="min-w-0 flex-1">{children}</div>{allowed && <button type="button" title="Редактировать ячейку" aria-label={`Редактировать ${field}: ${activity.title}`} onClick={e => { e.stopPropagation(); setValue(field === 'deadline' ? activity.next_intake?.deadline ?? '' : activity[field] ?? ''); setEditing(true) }} className="shrink-0 rounded-ctl p-1 text-ds-muted opacity-60 hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>}</div>}
  </div>
}
const filters: Array<{ key: CatalogFilter; label: string }> = [{ key: 'all', label: 'Все' }, { key: 'published', label: 'Опубликовано' }, { key: 'draft', label: 'Черновики' }, { key: 'review', label: 'Проверить' }, { key: 'archived', label: 'Архив' }]

export function StaffCatalog({ catalog, editable, onOpen, onPreview, onRecommend, onCreate, forStudent }: { catalog: Activity[]; editable: boolean; onOpen: (a: Activity) => void; onPreview: (a: Activity) => void; onRecommend: (a: Activity) => void; onCreate: () => void; forStudent?: string }) {
  const [mode, setMode] = useState<'table' | 'cards'>('table')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const client = useQueryClient()
  // Копия похожей возможности: карточка и типовые шаги, без старых сроков.
  const copy = useMutation({ mutationFn: (a: Activity) => activitiesApi.duplicate(a.id), onSuccess: a => { client.invalidateQueries({ queryKey: ['activities'] }); onOpen(a) } })
  const [params, setParams] = useSearchParams()
  const type = isExperienceKey(params.get('type')) ? params.get('type') as ExperienceKey : ''
  const setType = (next: ExperienceKey | '') => { const p = new URLSearchParams(params); if (next) p.set('type', next); else p.delete('type'); setParams(p, { replace: true }) }
  const rows = catalog.filter(a => matchesCatalogFilter(a, filter) && (!type || (a.experience_type ?? 'other') === type) && `${a.title} ${a.organizer ?? ''} ${a.country ?? ''} ${a.kind ?? ''} ${a.direction ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))
  return <div className="space-y-4">
    <div className="relative max-w-xl"><Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" /><Input aria-label="Поиск активностей" className="pl-10" placeholder="Найти активность, организатора или направление" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="flex flex-wrap gap-2">{filters.map(f => <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} count={catalog.filter(a => matchesCatalogFilter(a, f.key)).length}>{f.label}</FilterChip>)}</div>
    <ExperienceChips items={catalog.filter(a => matchesCatalogFilter(a, filter))} value={type} onChange={setType} />
    {forStudent && <div className="flex flex-wrap items-center gap-3 rounded-panel border border-ds-accent-dim bg-ds-accent/[0.07] px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">Подбираете для <b>{forStudent}</b>. «Рекомендовать» откроет выдачу с этим учеником.</span>
      {editable && <AppButton size="sm" variant="subtle" onClick={onCreate}>Нет подходящей — создать</AppButton>}
    </div>}
    {copy.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(copy.error)}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-ds-muted">Карточки показывают оформление ученика. Черновики доступны здесь только сотрудникам.</p>
      <div className="flex gap-2" aria-label="Вид каталога"><FilterChip active={mode === 'table'} onClick={() => setMode('table')}>Таблицей</FilterChip><FilterChip active={mode === 'cards'} onClick={() => setMode('cards')}>Карточками</FilterChip></div>
    </div>
    {mode === 'cards' ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map(a => <div key={a.id} className="flex min-w-0 flex-col gap-2"><ActivityCatalogCard activity={a} hidePlanAction onOpen={() => onPreview(a)} /><div className="flex flex-wrap items-center justify-between gap-2 px-2"><PublicationStatus publication={a.publication} /><div className="flex gap-3"><button type="button" onClick={() => onOpen(a)} className="text-xs font-bold underline underline-offset-4">Данные</button><button type="button" onClick={() => onRecommend(a)} className="text-xs font-bold underline underline-offset-4">Рекомендовать</button>{editable && <button type="button" disabled={copy.isPending} onClick={() => copy.mutate(a)} className="text-xs font-bold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Копия</button>}</div></div></div>)}{!rows.length && <p className="py-8 text-sm text-ds-muted">Активности не найдены — измените поиск или фильтр.</p>}</div> : <div className="overflow-x-auto rounded-card border border-ds-line bg-ds-panel"><table className="w-full min-w-[680px] table-fixed text-left text-sm"><thead className="border-b border-ds-line bg-ds-panel2 text-xs text-ds-muted"><tr><th className="w-[38%] px-5 py-3">Активность</th><th className="w-[23%] px-4 py-3">Направление</th><th className="w-[20%] px-4 py-3">Набор / срок</th><th className="w-[19%] px-4 py-3">Публикация</th></tr></thead><tbody>{rows.map(a => { const date = dateSummary(a); return <tr key={a.id} className="cursor-pointer border-b border-ds-line last:border-0 hover:bg-ds-panel2" onClick={() => onOpen(a)}>
      <td className="px-5 py-5 align-top"><InlineCell activity={a} field="title" editable={editable} catalog={catalog}><button title={a.title} className="line-clamp-2 break-words text-left font-bold" onClick={() => onOpen(a)}>{a.title}</button></InlineCell><p title={[a.kind, a.organizer, a.country].filter(Boolean).join(' · ')} className="mt-1 line-clamp-2 text-xs text-ds-muted">{[a.kind, a.organizer, a.country].filter(Boolean).join(' · ') || 'Данные уточняются'}</p></td>
      <td className="px-4 py-5 align-top"><InlineCell activity={a} field="direction" editable={editable} catalog={catalog}><DirectionBadge direction={a.direction} /></InlineCell></td>
      <td className="px-4 py-5 align-top"><InlineCell activity={a} field="deadline" editable={editable} catalog={catalog}><p className="font-semibold">{date.short}</p><p title={date.hint} className="mt-1 line-clamp-2 text-xs text-ds-muted">{date.hint}</p></InlineCell></td>
      <td className="px-4 py-5 align-top"><InlineCell activity={a} field="publication" editable={editable} catalog={catalog}><PublicationStatus publication={a.publication} /></InlineCell>{filter === 'review' && <p className="mt-2 text-xs text-ds-muted">{a.review_issues?.join(' · ')}</p>}</td>
    </tr> })}</tbody></table>{!rows.length && <div className="p-10 text-center"><p className="font-bold">Активности не найдены</p><p className="mt-2 text-sm text-ds-muted">Измените поиск или фильтр публикации.</p></div>}
    {editable && <div className="border-t border-ds-line p-3"><AppButton variant="subtle" onClick={onCreate}>+ Новая активность</AppButton></div>}</div>}
  </div>
}
