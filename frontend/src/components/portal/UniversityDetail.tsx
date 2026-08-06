import React, { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ExternalLink, Globe, Pencil, Trash2 } from 'lucide-react'
import { universitiesApi, DegreeLevel } from '@/api/universities'
import { UniversityFormDialog } from './UniversityFormDialog'
import { toast } from '@/hooks/use-toast'

const DEGREE_LABELS: Record<DegreeLevel, string> = {
  undergraduate: 'Бакалавриат',
  masters: 'Магистратура',
  doctorate: 'Докторантура',
}

// Buckets produced by the backend parser (services/tilda_text_parser.py).
const REQUIREMENT_LABELS: Record<string, string> = {
  bachelor: 'Бакалавриат',
  master: 'Магистратура',
  doctorate: 'Докторантура',
  general: 'Общие требования',
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-6 rounded-card border border-p-line bg-p-panel p-5">
    <h2 className="font-display text-sm font-black uppercase tracking-[0.16em] text-p-muted2">{title}</h2>
    <div className="mt-3">{children}</div>
  </section>
)

export const UniversityDetail: React.FC<{ basePath?: string; canManage?: boolean }> = ({
  basePath = '/portal/universities',
  canManage = false,
}) => {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)

  const removeMutation = useMutation({
    mutationFn: () => universitiesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['universities'] })
      toast({ title: 'Университет удалён' })
      navigate(basePath)
    },
    onError: () => toast({ title: 'Не удалось удалить', variant: 'destructive' }),
  })
  const { data: u, isLoading, isError } = useQuery({
    queryKey: ['university', id],
    queryFn: () => universitiesApi.getById(id),
    enabled: Boolean(id),
  })

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <div className="h-8 w-40 animate-pulse rounded-ctl bg-p-panel2" />
        <div className="mt-4 h-64 animate-pulse rounded-card bg-p-panel" />
      </div>
    )
  }

  if (isError || !u) {
    return (
      <div className="animate-fade-in rounded-card border border-p-line bg-p-panel p-8 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-panel bg-brand/15">
          <Globe className="h-5 w-5 text-brand" />
        </div>
        <h1 className="mt-4 text-base font-extrabold text-p-text">Университет не найден</h1>
        <Link to={basePath} className="mt-3 inline-block text-sm font-bold text-brand hover:underline">
          ← Вернуться к каталогу
        </Link>
      </div>
    )
  }

  const grants = u.has_grants_status ?? (u.has_grants ? 'yes' : 'unknown')
  const faculties = u.faculties || []
  const requirementEntries = Object.entries(u.requirements || {})
  // The source deadline prose is frequently years out of date, so it is
  // presented as reference material rather than as actionable dates.
  const currentYear = new Date().getFullYear()
  const deadlineIsStale =
    u.deadline_year_mentioned != null && u.deadline_year_mentioned < currentYear

  return (
    <div className="animate-fade-in">
      <Link
        to={basePath}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-p-muted transition-colors hover:text-p-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Каталог университетов
      </Link>

      <div className="mt-3 overflow-hidden rounded-card border border-p-line bg-gradient-to-b from-p-panel to-p-bg">
        {u.photo_url && (
          <div className="h-44 w-full overflow-hidden sm:h-56">
            <img src={u.photo_url} alt={u.name} className="h-full w-full object-cover" />
          </div>
        )}
        <div className="p-6">
          <h1 className="font-display text-[28px] font-black leading-tight tracking-tight text-p-text">{u.name}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-p-muted">
              {u.country_flag_emoji ? `${u.country_flag_emoji} ` : ''}
              {[u.country_name, u.city].filter(Boolean).join(' · ')}
            </span>
            {u.world_ranking != null && (
              <span className="whitespace-nowrap rounded-full border border-p-line bg-p-panel2 px-2.5 py-0.5 text-[11px] font-bold text-brand">
                #{u.world_ranking} в мире
              </span>
            )}
          </div>

          {(u.degree_levels || []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(u.degree_levels || []).map((d) => (
                <span key={d} className="rounded-full bg-p-panel2 px-2.5 py-1 text-[11px] font-bold text-p-muted">
                  {DEGREE_LABELS[d]}
                </span>
              ))}
            </div>
          )}

          {u.description && (
            <p className="mt-4 max-w-[68ch] text-[14px] leading-relaxed text-p-muted">{u.description}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {u.website && (
              <a
                href={u.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-4 py-2 text-sm font-bold text-p-text transition-colors hover:border-brand-dim hover:text-brand"
              >
                Сайт университета
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-4 py-2 text-sm font-bold text-p-muted transition-colors hover:text-p-text"
                >
                  <Pencil className="h-4 w-4" />
                  Редактировать
                </button>
                <button
                  type="button"
                  disabled={removeMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Удалить «${u.name}» из каталога? Он пропадёт у всех студентов.`)) {
                      removeMutation.mutate()
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-4 py-2 text-sm font-bold text-p-danger transition-colors hover:border-p-danger disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </button>
              </>
            )}
          </div>

          {canManage && (
            <UniversityFormDialog open={editOpen} onOpenChange={setEditOpen} university={u} />
          )}
        </div>
      </div>

      {faculties.length > 0 && (
        <Section title={`Факультеты и направления (${faculties.length})`}>
          {/* Columns rather than a wrapped pill cloud: names here run long
              ("Факультет сельскохозяйственных и пищевых наук…") and a dense
              cloud of them is hard to scan. */}
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {faculties.map((f) => (
              <li key={f} className="flex gap-2.5 text-[13px] leading-relaxed text-p-text">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-brand/60" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {requirementEntries.length > 0 && (
        <Section title="Требования к поступлению">
          <div className="space-y-5">
            {requirementEntries.map(([bucket, items]) => (
              <div key={bucket}>
                <h3 className="text-[12px] font-black uppercase tracking-wider text-brand">
                  {REQUIREMENT_LABELS[bucket] || bucket}
                </h3>
                {/* Bullets, not one long paragraph — the source lists these as
                    separate points and reading them as a wall is the whole
                    complaint this page had. */}
                <ul className="mt-2 space-y-1.5">
                  {items.map((item, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-p-muted">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-brand/60" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Стоимость и финансирование">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-p-muted2">Обучение</dt>
            <dd className="mt-1 text-[13.5px] font-bold text-p-text">
              {u.tuition_range || <span className="font-normal text-p-muted2">нет данных</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-p-muted2">Гранты</dt>
            <dd className="mt-1 text-[13.5px] font-bold">
              {grants === 'yes' && <span className="text-p-good">Есть полный грант для иностранцев</span>}
              {grants === 'no' && <span className="text-p-text">Полного гранта нет</span>}
              {grants === 'unknown' && (
                <span className="font-normal text-p-muted2">
                  Нет данных — уточните у ментора или на сайте вуза
                </span>
              )}
            </dd>
          </div>
          {u.grant_note && (
            <div className="sm:col-span-2">
              <dt className="text-[10px] uppercase tracking-widest text-p-muted2">Финансовая помощь</dt>
              <dd className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-p-muted">
                {u.grant_note}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {u.deadline_note && (
        <Section title="Дедлайны (справочно)">
          {deadlineIsStale && (
            <div className="mb-3 flex items-start gap-2 rounded-ctl border border-p-accent/40 bg-p-accent/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-p-accent" />
              <p className="text-[12.5px] leading-relaxed text-p-text">
                В источнике указан {u.deadline_year_mentioned} год — даты устарели. Проверьте актуальные
                сроки на сайте университета.
              </p>
            </div>
          )}
          {/* The source joins several deadlines with ";" into one line —
              split them so each reads as its own entry. */}
          {(() => {
            const parts = u.deadline_note
              .split(/;\s*/)
              .map((p) => p.trim())
              .filter(Boolean)
            return parts.length > 1 ? (
              <ul className="space-y-1.5">
                {parts.map((part, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-p-muted">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-brand/60" />
                    <span>{part}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-p-muted">{u.deadline_note}</p>
            )
          })()}
        </Section>
      )}

      {/* The full source text is deliberately not rendered: it repeats the
          city, faculties, requirements and deadlines already shown above as
          structured blocks, just as one unbroken wall. The short blurb in the
          header covers what it adds. */}

      {u.source_tilda_url && (
        <p className="mt-6 text-[11px] text-p-muted2">
          Источник:{' '}
          <a href={u.source_tilda_url} target="_blank" rel="noreferrer" className="underline hover:text-p-muted">
            страница вуза на teenteched.com
          </a>
        </p>
      )}
    </div>
  )
}
