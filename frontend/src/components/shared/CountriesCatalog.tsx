import React, { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Edit2, Globe, Plus, Search, X } from 'lucide-react'
import { countriesApi } from '@/api/index'
import type { Country } from '@/types'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { useLocalState } from '@/lib/use-local-state'
import { QueryState } from '@/components/shared/QueryState'

/** Каталог стран — общий для CRM, воркспейса и портала.
 *
 * До этого одна и та же вёрстка карточки жила в двух файлах (воркспейс и
 * портал) почти дословно, вместе с превью roadmap. Каталог вузов эту задачу
 * уже решал одним компонентом с basePath/canManage — здесь тот же приём.
 *
 * Карточка ведёт на страницу страны: раньше кнопки UG/Graduate открывали
 * модалку, из которой нельзя было попасть ни к вузам страны, ни к деталям.
 */
export const CountriesCatalog: React.FC<{
  eyebrow?: string
  basePath?: string
  canManage?: boolean
}> = ({ eyebrow = 'База знаний', basePath = '/countries', canManage = false }) => {
  const [search, setSearch] = useLocalState('countries:search', '')
  const [degreeFilter, setDegreeFilter] = useLocalState<'all' | 'undergraduate' | 'graduate'>(
    'countries:degree',
    'all'
  )
  // undefined — диалог закрыт; null — создание; страна — редактирование
  const [editing, setEditing] = useState<Country | null | undefined>(undefined)

  const { data: countries = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['countries'],
    queryFn: countriesApi.list,
  })
  const deferredSearch = useDeferredValue(search)

  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return countries
      .filter((country) => {
        const levels = country.degree_levels ?? ['undergraduate', 'graduate']
        const matchesDegree = degreeFilter === 'all' || levels.includes(degreeFilter)
        const matchesSearch =
          !q ||
          country.country_name.toLowerCase().includes(q) ||
          country.notes?.toLowerCase().includes(q) ||
          country.submission_deadline_notes?.toLowerCase().includes(q)
        return matchesDegree && matchesSearch
      })
      .sort((a, b) => a.country_name.localeCompare(b.country_name, 'ru'))
  }, [countries, degreeFilter, deferredSearch])

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">
            {eyebrow}
          </p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Страны</h1>
          <p className="mt-2 max-w-[560px] text-sm text-p-muted">
            Требования, дедлайны, примечания и шаблоны roadmap для UG и Graduate.
          </p>
        </div>
        {canManage && (
          <AppButton colorPrefix="p" onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" />
            Добавить страну
          </AppButton>
        )}
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск страны, дедлайна или примечания…"
            className="h-11 w-full rounded-ctl border border-p-line bg-p-panel2 pl-10 pr-10 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand-dim"
          />
          {search && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-p-muted2 hover:text-p-text"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex rounded-full border border-p-line bg-p-panel p-1">
          {(
            [
              ['all', 'Все'],
              ['undergraduate', 'UG'],
              ['graduate', 'Graduate'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDegreeFilter(value)}
              className={`rounded-full px-4 py-2 text-xs font-black transition ${
                degreeFilter === value ? 'bg-p-accent text-black' : 'text-p-muted hover:text-p-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <QueryState
        colorPrefix="ds"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={visible.length === 0}
        skeleton={(
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-card border border-p-line bg-p-panel" />
            ))}
          </div>
        )}
        empty={(
          <div className="rounded-card border border-p-line bg-p-panel p-8 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-panel bg-brand/15">
              <Globe className="h-5 w-5 text-brand" />
            </div>
            <h2 className="mt-4 text-base font-extrabold text-p-text">Страны не найдены</h2>
            <p className="mt-1.5 text-sm text-p-muted">
              Попробуйте изменить поисковый запрос или фильтр.
            </p>
          </div>
        )}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((country) => (
            <CountryCard
              key={country.id}
              country={country}
              basePath={basePath}
              canManage={canManage}
              onEdit={() => setEditing(country)}
            />
          ))}
        </div>
      </QueryState>

      {editing !== undefined && (
        <CountryDialog country={editing || undefined} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

const CountryCard: React.FC<{
  country: Country
  basePath: string
  canManage: boolean
  onEdit: () => void
}> = ({ country, basePath, canManage, onEdit }) => {
  const levels = country.degree_levels ?? ['undergraduate', 'graduate']

  return (
    <article className="relative overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-[22px] transition-colors hover:border-brand-dim">
      {country.flag_url && (
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-cover bg-center opacity-[0.14] [filter:grayscale(0.2)]"
          style={{ backgroundImage: `url('${country.flag_url}')` }}
          aria-hidden="true"
        />
      )}
      <div className="relative">
        {/* Ссылку вешаем на заголовок, а не на всю карточку: внутри есть свои
            кнопки, и <a> вокруг них проглотил бы клики. */}
        <Link
          to={`${basePath}/${country.id}`}
          className="font-display text-xl font-extrabold leading-snug text-p-text outline-none hover:underline focus-visible:underline"
        >
          {country.country_name}
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-p-muted">
            {country.flag_emoji ? `${country.flag_emoji} ` : ''}
            {country.country_name}
          </span>
        </div>

        {country.submission_deadline_notes && (
          <p className="mt-3 line-clamp-2 min-h-[38px] text-[12.5px] leading-relaxed text-p-muted">
            {country.submission_deadline_notes}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3 border-t border-p-line pt-3.5">
          {country.vpp_required && (
            <span className="whitespace-nowrap rounded-full bg-p-accent/15 px-3 py-1 text-[10.5px] font-bold text-p-accent">
              VPP требуется
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {canManage && (
              <button
                type="button"
                aria-label={`Редактировать ${country.country_name}`}
                onClick={onEdit}
                className="grid h-9 w-9 flex-none place-items-center rounded-ctl border border-p-line bg-p-panel2 text-p-muted transition-colors hover:border-brand-dim hover:text-p-accent"
              >
                <Edit2 className="h-4 w-4" />
              </button>
            )}
            {/* Уровни ведут на ту же страницу страны с выбранной вкладкой —
                раньше это была модалка без выхода к вузам. */}
            {levels.includes('undergraduate') && (
              <Link
                to={`${basePath}/${country.id}?degree=undergraduate`}
                className="inline-flex items-center gap-1 rounded-full border border-p-accent bg-p-accent px-3 py-1.5 text-[10.5px] font-black text-black transition hover:opacity-90"
              >
                UG
                <ChevronRight className="h-3 w-3" />
              </Link>
            )}
            {levels.includes('graduate') && (
              <Link
                to={`${basePath}/${country.id}?degree=graduate`}
                className="inline-flex items-center gap-1 rounded-full border border-p-accent bg-p-accent px-3 py-1.5 text-[10.5px] font-black text-black transition hover:opacity-90"
              >
                Graduate
                <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

export const CountryDialog: React.FC<{ country?: Country; onClose: () => void }> = ({
  country,
  onClose,
}) => {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    country_name: country?.country_name || '',
    vpp_required: country?.vpp_required || false,
    submission_deadline_notes: country?.submission_deadline_notes || '',
    notes: country?.notes || '',
    degree_levels: country?.degree_levels ?? ['undergraduate', 'graduate'],
  })

  const mutation = useMutation({
    mutationFn: () => (country ? countriesApi.update(country.id, form) : countriesApi.create(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['countries'] })
      toast({ title: country ? 'Страна обновлена' : 'Страна добавлена' })
      onClose()
    },
    onError: (e) =>
      toast({ title: getErrorMessage(e, 'Не удалось сохранить страну'), variant: 'destructive' }),
  })

  const control =
    'w-full rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-sm text-p-text outline-none focus:border-brand-dim'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{country ? 'Редактировать страну' : 'Добавить страну'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <input
            value={form.country_name}
            onChange={(event) => setForm({ ...form, country_name: event.target.value })}
            placeholder="Название страны"
            className={control}
          />
          <label className="flex items-center gap-2 text-sm text-p-text">
            <input
              type="checkbox"
              checked={form.vpp_required}
              onChange={(event) => setForm({ ...form, vpp_required: event.target.checked })}
            />
            Требуется VPP / УП
          </label>
          <fieldset className="rounded-ctl border border-p-line p-3">
            <legend className="px-1 text-xs font-bold text-p-muted">Уровни поступления</legend>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ['undergraduate', 'UG / Бакалавриат'],
                  ['graduate', 'Graduate / Магистратура'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-p-text">
                  <input
                    type="checkbox"
                    checked={form.degree_levels.includes(value)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        degree_levels: event.target.checked
                          ? [...form.degree_levels, value]
                          : form.degree_levels.filter((item: string) => item !== value),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <input
            value={form.submission_deadline_notes}
            onChange={(event) => setForm({ ...form, submission_deadline_notes: event.target.value })}
            placeholder="Дедлайн подач"
            className={control}
          />
          <textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="Примечания"
            className={`min-h-28 ${control}`}
          />
          <div className="flex justify-end gap-2">
            <AppButton colorPrefix="p" variant="ghost" onClick={onClose}>
              Отмена
            </AppButton>
            <AppButton
              colorPrefix="p"
              disabled={
                !form.country_name.trim() || form.degree_levels.length === 0 || mutation.isPending
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
            </AppButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
