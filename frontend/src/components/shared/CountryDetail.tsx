import React, { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Building2, CalendarClock, Globe, Route } from 'lucide-react'
import { countriesApi } from '@/api/index'
import { universitiesApi } from '@/api/universities'
import { roadmapApi, RoadmapTemplate, TemplateListItem } from '@/api/roadmap'
import { QueryError } from '@/components/shared/QueryState'

type Degree = 'undergraduate' | 'graduate'

/** Словарь уровней у страны, шаблона и вуза расходится исторически:
 *  страна — undergraduate|graduate, шаблон — bachelors|masters. Перевод был
 *  продублирован в двух каталогах; держим его в одном месте. */
export const templateDegreeFor = (degree: Degree): string =>
  degree === 'graduate' ? 'masters' : 'bachelors'

/** Страница страны: roadmap по уровню + вузы этой страны.
 *
 * Раньше кнопки UG/Graduate открывали модалку с шаблоном, из которой нельзя
 * было попасть ни к вузам, ни к деталям — путь обрывался.
 */
export const CountryDetail: React.FC<{
  basePath?: string
  universitiesPath?: string
  canManage?: boolean
}> = ({ basePath = '/countries', universitiesPath = '/universities' }) => {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const initialDegree = searchParams.get('degree') === 'graduate' ? 'graduate' : 'undergraduate'
  const [degree, setDegree] = useState<Degree>(initialDegree)

  // Отдельного GET /countries/{id} нет, а список небольшой и уже закэширован —
  // берём страну из него, а не заводим ручку ради одной строки.
  const { data: countries = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['countries'],
    queryFn: countriesApi.list,
  })
  const country = countries.find((c) => c.id === id)

  const { data: universities = [] } = useQuery({
    queryKey: ['universities'],
    queryFn: universitiesApi.list,
  })
  const { data: templates = [] } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
  })

  // Фильтруем по названию: country_ref_id у вузов не заполнен (проверено на
  // базе — 0 из 200), поэтому строка сейчас единственный рабочий ключ.
  const countryUniversities = useMemo(() => {
    if (!country) return []
    const name = country.country_name.toLocaleLowerCase('ru')
    return universities
      .filter((u) => u.country_name?.toLocaleLowerCase('ru') === name)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [universities, country])

  const template = useMemo<TemplateListItem | undefined>(() => {
    if (!country) return undefined
    const expected = templateDegreeFor(degree)
    return templates.find(
      (item) =>
        item.country_name?.toLocaleLowerCase('ru') === country.country_name.toLocaleLowerCase('ru') &&
        item.degree === expected
    )
  }, [templates, country, degree])

  // Без этой ветки любая ошибка показывала «roadmap-шаблон пока не добавлен» —
  // утверждение о содержимом справочника вместо признания, что он не пришёл.
  if (isError) {
    return <QueryError error={error} onRetry={refetch} />
  }

  if (isLoading) {
    return <div className="rounded-card border border-p-line bg-p-panel p-5 text-sm text-p-muted">Загрузка…</div>
  }

  if (!country) {
    return (
      <div className="rounded-card border border-p-line bg-p-panel p-8 text-center">
        <Globe className="mx-auto h-6 w-6 text-p-muted2" />
        <h2 className="mt-3 text-base font-extrabold text-p-text">Страна не найдена</h2>
        <Link to={basePath} className="mt-3 inline-block text-sm font-bold text-p-accent hover:underline">
          Вернуться к списку
        </Link>
      </div>
    )
  }

  const levels = country.degree_levels ?? ['undergraduate', 'graduate']

  return (
    <div className="animate-fade-in">
      <Link
        to={basePath}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-p-muted transition-colors hover:text-p-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Все страны
      </Link>

      <header className="relative mt-3 overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg p-[22px]">
        {country.flag_url && (
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full bg-cover bg-center opacity-[0.14] [filter:grayscale(0.2)]"
            style={{ backgroundImage: `url('${country.flag_url}')` }}
            aria-hidden="true"
          />
        )}
        <div className="relative">
          <h1 className="font-display text-[32px] font-black tracking-tight text-p-text">
            {country.flag_emoji ? `${country.flag_emoji} ` : ''}
            {country.country_name}
          </h1>
          {country.submission_deadline_notes && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-p-muted">
              <CalendarClock className="h-4 w-4 flex-none" />
              Дедлайны: {country.submission_deadline_notes}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {country.vpp_required && (
              <span className="rounded-full bg-p-accent/15 px-3 py-1 text-[10.5px] font-bold text-p-accent">
                VPP требуется
              </span>
            )}
            {levels.map((level) => (
              <span
                key={level}
                className="rounded-full bg-p-panel2 px-3 py-1 text-[10.5px] font-bold text-p-muted"
              >
                {level === 'graduate' ? 'Магистратура' : 'Бакалавриат'}
              </span>
            ))}
          </div>
          {country.notes && <p className="mt-3 text-sm leading-relaxed text-p-muted">{country.notes}</p>}
        </div>
      </header>

      <section className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-black text-p-text">
            <Route className="h-5 w-5 text-p-accent" /> Roadmap
          </h2>
          <div className="flex rounded-full border border-p-line bg-p-panel p-1">
            {levels.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setDegree(level as Degree)}
                className={`rounded-full px-4 py-2 text-xs font-black transition ${
                  degree === level ? 'bg-p-accent text-black' : 'text-p-muted hover:text-p-text'
                }`}
              >
                {level === 'graduate' ? 'Graduate' : 'UG'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <RoadmapSection template={template} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-black text-p-text">
          <Building2 className="h-5 w-5 text-p-accent" /> Вузы страны
          <span className="text-sm font-bold text-p-muted2">({countryUniversities.length})</span>
        </h2>

        {countryUniversities.length === 0 ? (
          <p className="mt-3 rounded-card border border-dashed border-p-line p-5 text-center text-sm text-p-muted">
            Вузы этой страны ещё не добавлены в справочник.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {countryUniversities.map((u) => (
              <li key={u.id}>
                <Link
                  to={`${universitiesPath}/${u.id}`}
                  className="flex items-start gap-3 rounded-card border border-p-line bg-p-panel p-3 transition-colors hover:border-brand-dim"
                >
                  {u.photo_url ? (
                    <img
                      src={u.photo_url}
                      alt=""
                      className="h-12 w-12 flex-none rounded-ctl object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="grid h-12 w-12 flex-none place-items-center rounded-ctl bg-p-panel2 text-base">
                      {u.country_flag_emoji || '🎓'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-p-text">{u.name}</span>
                    <span className="block truncate text-xs text-p-muted">
                      {[u.city, u.tuition_range].filter(Boolean).join(' · ') || '—'}
                    </span>
                    {typeof u.world_ranking === 'number' && (
                      <span className="mt-1 inline-block rounded-full bg-p-accent/15 px-2 py-0.5 text-[10px] font-bold text-p-accent">
                        #{u.world_ranking} в мире
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Шаблон roadmap страны. Вынесен из модалок обоих каталогов — там он был
 *  продублирован дословно. */
export const RoadmapSection: React.FC<{ template?: TemplateListItem }> = ({ template }) => {
  const { data: full, isLoading, isError: fullFailed, error: fullError, refetch: refetchFull } = useQuery({
    queryKey: ['roadmap-template', template?.id],
    queryFn: () => roadmapApi.getTemplate(template!.id),
    enabled: Boolean(template),
  })

  if (!template) {
    return (
      <div className="rounded-card border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">
        Для этого направления roadmap-шаблон пока не добавлен.
      </div>
    )
  }
  if (fullFailed) {
    return <QueryError error={fullError} onRetry={refetchFull} />
  }

  if (isLoading || !full) {
    return <div className="rounded-card border border-p-line bg-p-panel p-6 text-sm text-p-muted">Загрузка roadmap…</div>
  }
  return <TemplateStages template={full} />
}

export const TemplateStages: React.FC<{ template: RoadmapTemplate }> = ({ template }) => (
  <div className="space-y-3">
    {template.description && <p className="text-sm leading-6 text-p-muted">{template.description}</p>}
    {template.stages.map((stage, index) => (
      <section key={stage.id} className="rounded-panel border border-p-line bg-p-panel2 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-p-accent text-xs font-black text-black">
            {index + 1}
          </span>
          <h3 className="font-black text-p-text">{stage.name}</h3>
        </div>
        {stage.description && <p className="ml-10 mt-1 text-xs text-p-muted">{stage.description}</p>}
        <div className="ml-10 mt-3 space-y-2">
          {stage.tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-2 text-sm text-p-muted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-p-accent" />
              <span>{task.title}</span>
            </div>
          ))}
        </div>
      </section>
    ))}
  </div>
)
