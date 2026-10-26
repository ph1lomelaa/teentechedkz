import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search } from 'lucide-react'
import { activitiesApi, type Activity, type ExperienceKey } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { intakeLabel, isExperienceKey, matchesCatalogFilter, type CatalogFilter } from '@/lib/activityUi'
import { EXPERIENCE_LABEL, EXPERIENCE_TYPES, INTAKE_MODE_LABEL, formatDay } from '@/lib/portfolio/dictionary'
import { getErrorMessage } from '@/lib/errorMessage'
import { DirectionBadge, FilterBar, FilterSelect, PublicationStatus } from './ActivityParts'
import { ActivityCatalogCard } from './ActivityCards'

/** «до 25 нояб. · набор осень 2026», «Принимают постоянно», «В своём темпе». */
function intakeText(a: Activity): string {
  const i = a.next_intake
  if (!i) return a.intake_count ? 'Набор закрыт' : 'Сроки не указаны'
  const label = intakeLabel(i)
  if (i.deadline) return [`до ${formatDay(i.deadline)}`, label ? `набор ${label.toLocaleLowerCase('ru')}` : null].filter(Boolean).join(' · ')
  if (i.mode === 'rolling') return INTAKE_MODE_LABEL.rolling
  if (i.mode === 'self_paced') return INTAKE_MODE_LABEL.self_paced
  return i.dates_text?.trim() || 'Сроки не указаны'
}

type StatusFilter = Exclude<CatalogFilter, 'all'>

/** Каталог для команды: одна строка фильтров, клик по строке открывает активность. */
export function StaffCatalog({ catalog, editable, onOpen, onPreview, onRecommend, onCreate, forStudent }: { catalog: Activity[]; editable: boolean; onOpen: (a: Activity) => void; onPreview: (a: Activity) => void; onRecommend: (a: Activity) => void; onCreate: () => void; forStudent?: string }) {
  const [mode, setMode] = useState<'table' | 'cards'>('table')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('published')
  const client = useQueryClient()
  // Копия похожей возможности: карточка и типовые шаги, без старых сроков.
  const copy = useMutation({ mutationFn: (a: Activity) => activitiesApi.duplicate(a.id), onSuccess: a => { client.invalidateQueries({ queryKey: ['activities'] }); onOpen(a) } })
  const [params, setParams] = useSearchParams()
  const type = isExperienceKey(params.get('type')) ? params.get('type') as ExperienceKey : ''
  const setType = (next: ExperienceKey | '') => { const p = new URLSearchParams(params); if (next) p.set('type', next); else p.delete('type'); setParams(p, { replace: true }) }
  const count = (f: StatusFilter) => catalog.filter(a => matchesCatalogFilter(a, f)).length
  const rows = catalog.filter(a => matchesCatalogFilter(a, filter) && (!type || (a.experience_type ?? 'other') === type) && `${a.title} ${a.organizer ?? ''} ${a.country ?? ''} ${a.kind ?? ''} ${a.direction ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-full sm:basis-64"><Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" /><Input aria-label="Поиск активностей" className="pl-10" placeholder="Активность, организатор или направление" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <FilterSelect label="Тип опыта" value={type} onChange={setType} options={EXPERIENCE_TYPES.map(t => ({ value: t.key, label: t.short, count: catalog.filter(a => (a.experience_type ?? 'other') === t.key).length })).filter(o => o.count)} />
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <FilterBar label="Публикация" value={filter} onChange={setFilter} options={[
        { value: 'published', label: 'Опубликовано', count: count('published') },
        { value: 'draft', label: 'Черновики', count: count('draft') },
        { value: 'review', label: 'Нужно дополнить', count: count('review') },
        ...(filter === 'archived' ? [{ value: 'archived' as const, label: 'Архив', count: count('archived') }] : []),
      ]} />
      <FilterBar label="Вид каталога" value={mode} onChange={setMode} options={[{ value: 'table', label: 'Таблицей' }, { value: 'cards', label: 'Карточками' }]} />
    </div>
    {forStudent && <div className="flex flex-wrap items-center gap-3 rounded-panel border border-ds-line bg-ds-panel2 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">Подбор для ученика: <b>{forStudent}</b>. «Рекомендовать» в строке откроет выдачу с этим учеником.</span>
      {editable && <button type="button" onClick={onCreate} className="text-sm font-semibold underline underline-offset-4">Нет подходящей</button>}
    </div>}
    {copy.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(copy.error)}</p>}
    {mode === 'cards'
      ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map(a => <div key={a.id} className="flex min-w-0 flex-col gap-2">
          <ActivityCatalogCard activity={a} hidePlanAction onOpen={() => onPreview(a)} />
          <div className="flex flex-wrap items-center justify-between gap-2 px-2"><PublicationStatus publication={a.publication} /><div className="flex gap-3">
            <button type="button" onClick={() => onOpen(a)} className="text-xs font-bold underline underline-offset-4">Изменить</button>
            <button type="button" onClick={() => onRecommend(a)} className="text-xs font-bold underline underline-offset-4">Рекомендовать</button>
            {editable && <button type="button" disabled={copy.isPending} onClick={() => copy.mutate(a)} className="text-xs font-bold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Копия</button>}
          </div></div>
        </div>)}{!rows.length && <p className="py-8 text-sm text-ds-muted">Активности не найдены. Измените поиск или фильтр.</p>}</div>
      : <div className="overflow-x-auto rounded-card border border-ds-line bg-ds-panel"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-ds-line bg-ds-panel2 text-xs text-ds-muted"><tr>{['Активность', 'Тип опыта', 'Направление', 'Набор', 'Публикация', ''].map((t, i) => <th key={i} className="px-4 py-3 font-semibold">{t}</th>)}</tr></thead>
          <tbody>{rows.map(a => <tr key={a.id} onClick={() => onOpen(a)} className="group cursor-pointer border-b border-ds-line align-top last:border-b-0 hover:bg-ds-panel2">
            <td className="px-4 py-3.5"><button type="button" className="break-words text-left font-bold" onClick={e => { e.stopPropagation(); onOpen(a) }}>{a.title}</button>
              {(a.organizer || a.country) && <p className="mt-0.5 text-xs text-ds-muted">{[a.organizer, a.country].filter(Boolean).join(' · ')}</p>}
              {filter === 'review' && !!a.review_issues?.length && <p className="mt-1 text-xs text-ds-danger">Не хватает: {a.review_issues.join(', ').toLocaleLowerCase('ru')}</p>}</td>
            <td className="px-4 py-3.5 text-ds-muted">{EXPERIENCE_LABEL[a.experience_type ?? 'other']}</td>
            <td className="px-4 py-3.5"><DirectionBadge direction={a.direction} /></td>
            <td className="px-4 py-3.5">{intakeText(a)}</td>
            <td className="px-4 py-3.5"><PublicationStatus publication={a.publication} /></td>
            <td className="px-4 py-3.5 text-right">{forStudent
              ? <AppButton size="sm" variant="subtle" onClick={e => { e.stopPropagation(); onRecommend(a) }}>Рекомендовать</AppButton>
              : <Pencil aria-hidden className="ml-auto h-4 w-4 text-ds-muted opacity-0 transition group-hover:opacity-100" />}</td>
          </tr>)}</tbody>
        </table>{!rows.length && <div className="p-10 text-center"><p className="font-bold">Активности не найдены</p><p className="mt-2 text-sm text-ds-muted">Измените поиск или фильтр.</p></div>}</div>}
    {count('archived') > 0 && filter !== 'archived' && <button type="button" onClick={() => setFilter('archived')} className="text-xs font-semibold text-ds-muted underline underline-offset-4 hover:text-ds-ink">Архив · {count('archived')}</button>}
  </div>
}
