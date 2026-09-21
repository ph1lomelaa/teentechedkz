import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { mentorAssignmentsApi, notesApi, pendingInsightsApi } from '@/api'
import { InsightCard } from '@/components/shared/InsightCard'
import { AppButton } from '@/components/ui/AppButton'
import { AppCard } from '@/components/ui/AppCard'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { toast } from '@/hooks/use-toast'
import { useCallback, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui'
import { FilterPopover, FilterField, FilterChips, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory, matchesDirectoryFilters, EMPTY_DIRECTORY_FILTERS, StudentDirectoryFilters } from '@/hooks/useStudentDirectory'
import { DEGREE_LEVEL_LABELS, DegreeLevel, InsightWithDiff } from '@/types'
import { QueryError } from '@/components/shared/QueryState'
import { getErrorMessage } from '@/lib/errorMessage'

/** Сколько разобранных показывать: история растёт без конца, смотрят последние. */
const RESOLVED_LIMIT = 30

/**
 * «Статус» — изменения в карточках студентов, которые ИИ нашёл в Telegram-чатах,
 * и черновики конспектов. Ничего не попадает в карточку без подтверждения.
 *
 * Предложения сгруппированы по студенту: раньше каждое было отдельной карточкой
 * со своей кнопкой «Взять студента» под ней, и у одного студента их набиралось
 * по три-четыре подряд.
 */
export default function StatusInboxPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [directoryFilters, setDirectoryFilters] = useState<StudentDirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const directory = useStudentDirectory()

  const { data: insights = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pending-insights', 'pending', scope],
    queryFn: () => pendingInsightsApi.listAll('pending', scope),
  })

  const resolvedQuery = useQuery({
    queryKey: ['pending-insights', 'resolved', scope],
    queryFn: () => pendingInsightsApi.listAll('resolved', scope, RESOLVED_LIMIT),
    enabled: showResolved,
  })

  const { data: draftNotes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['student-notes', 'draft', scope],
    queryFn: () => notesApi.list({ status: 'draft', scope }),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      pendingInsightsApi.review(id, action),
    onSuccess: (_data, { action }) => {
      qc.invalidateQueries({ queryKey: ['pending-insights'] })
      qc.invalidateQueries({ queryKey: ['student-notes'] })
      toast({ title: action === 'approve' ? 'Изменение внесено в карточку' : 'Предложение отклонено' })
    },
    onError: (e) => toast({ title: 'Не получилось', description: getErrorMessage(e), variant: 'destructive' }),
  })

  const noteReviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      notesApi.review(id, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-notes'] })
      qc.invalidateQueries({ queryKey: ['pending-insights'] })
      toast({ title: 'Конспект обработан' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось обработать конспект', variant: 'destructive' }),
  })

  const assignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-insights'] })
      toast({ title: 'Студент добавлен в ваши' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось взять студента', variant: 'destructive' }),
  })

  const matchesDirectory = useCallback(
    (studentId: string | null | undefined) =>
      matchesDirectoryFilters(studentId ? directory.byId.get(studentId) : undefined, directoryFilters),
    [directory.byId, directoryFilters],
  )

  const pending = useMemo(() => insights.filter((i) => matchesDirectory(i.student_id)), [insights, matchesDirectory])
  const resolved = useMemo(
    () => (resolvedQuery.data ?? []).filter((i) => matchesDirectory(i.student_id)),
    [resolvedQuery.data, matchesDirectory],
  )
  const filteredDraftNotes = useMemo(() => draftNotes.filter((n) => matchesDirectory(n.student_id)), [draftNotes, matchesDirectory])

  // Порядок групп — по самому свежему предложению (сервер отдаёт новые первыми).
  const groups = useMemo(() => {
    const byStudent = new Map<string, InsightWithDiff[]>()
    for (const insight of pending) {
      const list = byStudent.get(insight.student_id)
      if (list) list.push(insight)
      else byStudent.set(insight.student_id, [insight])
    }
    return [...byStudent.entries()].map(([studentId, items]) => ({ studentId, items }))
  }, [pending])

  const activeFiltersCount =
    (directoryFilters.year ? 1 : 0) +
    (directoryFilters.country ? 1 : 0) +
    (directoryFilters.degree ? 1 : 0) +
    (directoryFilters.responsibleId ? 1 : 0)
  const responsibleName = (id: string) => directory.responsibleUsers.find((u) => u.id === id)?.name ?? id
  const resetDirectoryFilters = () => setDirectoryFilters(EMPTY_DIRECTORY_FILTERS)
  const filterChips = [
    directoryFilters.year && { key: 'year', label: `Год: ${directoryFilters.year}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, year: '' })) },
    directoryFilters.country && { key: 'country', label: `Страна: ${directoryFilters.country}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, country: '' })) },
    directoryFilters.degree && {
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[directoryFilters.degree as DegreeLevel] ?? directoryFilters.degree}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, degree: '' })),
    },
    directoryFilters.responsibleId && {
      key: 'responsible',
      label: `Ответственный: ${responsibleName(directoryFilters.responsibleId)}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, responsibleId: '' })),
    },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Кабинет ментора"
        title="Статус"
        description="Изменения в карточках студентов, которые ИИ нашёл в Telegram-чатах, и черновики конспектов. Ничего не попадает в карточку без вашего подтверждения."
        colorPrefix="w"
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={scope}
          onChange={(value) => setScope(value as typeof scope)}
          tabs={[
            { value: 'all', label: 'Все' },
            { value: 'mine', label: 'Мои' },
          ]}
          colorPrefix="w"
        />

        <FilterPopover activeCount={activeFiltersCount} onReset={resetDirectoryFilters}>
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Год">
              <Select
                value={directoryFilters.year || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, year: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все годы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все годы</SelectItem>
                  {directory.years.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Ступень">
              <Select
                value={directoryFilters.degree || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, degree: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все ступени" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все ступени</SelectItem>
                  {directory.degrees.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {DEGREE_LEVEL_LABELS[opt.value as DegreeLevel] ?? opt.value} · {opt.count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          <FilterField label="Страна поступления">
            <Select
              value={directoryFilters.country || 'all'}
              onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, country: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все страны" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все страны</SelectItem>
                {directory.countries.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          {directory.canFilterByResponsible && (
            <FilterField label="Ответственный (ментор/МЗК)">
              <ResponsiblePicker
                users={directory.responsibleUsers}
                value={directoryFilters.responsibleId}
                onChange={(id) => setDirectoryFilters((f) => ({ ...f, responsibleId: id }))}
              />
            </FilterField>
          )}
        </FilterPopover>
      </div>

      {filterChips.length > 0 && (
        <div className="mb-5">
          <FilterChips chips={filterChips} onResetAll={resetDirectoryFilters} />
        </div>
      )}

      {/* Пустые состояния здесь у каждой секции свои, поэтому isEmpty не передаём —
          иначе они подменились бы одним общим. */}
      {isError || directory.isError ? (
        <QueryError colorPrefix="w" error={error} onRetry={refetch} />
      ) : isLoading || notesLoading ? (
        <p className="text-sm text-w-muted">Загрузка…</p>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <SectionTitle
              title="Изменения в карточках"
              count={pending.length}
              hint={groups.length > 0 ? `у ${groups.length} ${pluralStudents(groups.length)}` : undefined}
            />
            {groups.length === 0 ? (
              <EmptyBlock text="Новых изменений нет" />
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {groups.map(({ studentId, items }) => {
                  const first = items[0]
                  const responsibles = (first.responsibles ?? [])
                    .filter((r) => r.is_active && r.name)
                    .map((r) => r.name)
                  return (
                    <AppCard key={studentId} colorPrefix="w" className="space-y-3 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link to={`/students/${studentId}`} className="font-bold text-w-ink hover:underline">
                            {first.student_name || 'Студент'}
                          </Link>
                          <p className="text-xs text-w-muted">
                            {responsibles.length > 0 ? `Ответственные: ${responsibles.join(', ')}` : 'Нет ответственного'}
                          </p>
                        </div>
                        {!first.is_mine && (
                          <AppButton
                            colorPrefix="w"
                            variant="subtle"
                            size="sm"
                            disabled={assignSelfMutation.isPending}
                            onClick={() => assignSelfMutation.mutate(studentId)}
                          >
                            Взять студента
                          </AppButton>
                        )}
                      </div>
                      <div className="space-y-3">
                        {items.map((insight) => (
                          <InsightCard
                            key={insight.id}
                            insight={insight}
                            embedded
                            isPending={reviewMutation.isPending}
                            onApprove={() => reviewMutation.mutate({ id: insight.id, action: 'approve' })}
                            onReject={() => reviewMutation.mutate({ id: insight.id, action: 'reject' })}
                          />
                        ))}
                      </div>
                    </AppCard>
                  )
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle title="Черновики конспектов" count={filteredDraftNotes.length} />
            {filteredDraftNotes.length === 0 ? (
              <EmptyBlock text="Черновиков нет" />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredDraftNotes.map((note) => (
                  <AppCard key={note.id} colorPrefix="w" className="space-y-2 p-4 text-sm">
                    <div>
                      <Link to={`/notes/${note.id}`} className="text-xs text-w-accentText hover:underline">
                        {note.student_name || 'Без студента'}
                      </Link>
                      <p className="mt-1 font-bold text-w-ink">{note.title}</p>
                    </div>
                    <p className="line-clamp-3 text-xs text-w-muted">{stripMarkdown(note.summary_markdown)}</p>
                    {Object.keys(note.suggested_changes || {}).length > 0 && (
                      <p className="text-xs text-w-muted2">Есть предложения к полям карточки — откройте, чтобы проверить</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <AppButton size="sm" variant="ghost" colorPrefix="w" onClick={() => navigate(`/notes/${note.id}`)}>
                        Открыть
                      </AppButton>
                      <AppButton
                        size="sm"
                        variant="subtle"
                        colorPrefix="w"
                        disabled={noteReviewMutation.isPending}
                        onClick={() => noteReviewMutation.mutate({ id: note.id, action: 'approve' })}
                      >
                        Подтвердить
                      </AppButton>
                      <AppButton
                        size="sm"
                        variant="subtle"
                        colorPrefix="w"
                        disabled={noteReviewMutation.isPending}
                        onClick={() => noteReviewMutation.mutate({ id: note.id, action: 'reject' })}
                      >
                        Отклонить
                      </AppButton>
                    </div>
                  </AppCard>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <button
              type="button"
              className="text-sm font-bold text-w-muted hover:text-w-ink"
              onClick={() => setShowResolved((value) => !value)}
              aria-expanded={showResolved}
            >
              {showResolved ? '▾' : '▸'} Разобранные — последние {RESOLVED_LIMIT}
            </button>
            {showResolved &&
              (resolvedQuery.isLoading ? (
                <p className="text-sm text-w-muted">Загрузка…</p>
              ) : resolved.length === 0 ? (
                <EmptyBlock text="Пока ничего не разобрано" />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {resolved.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} showStudentLink onApprove={() => {}} onReject={() => {}} />
                  ))}
                </div>
              ))}
          </section>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold text-w-ink">
      {title}
      <span className="tabular-nums text-w-muted">{count}</span>
      {hint && <span className="text-xs font-normal text-w-muted">{hint}</span>}
    </h2>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-panel border border-w-line bg-w-panel2 p-5 text-center text-sm text-w-muted">{text}</div>
}

function pluralStudents(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'студента'
  return 'студентов'
}

function stripMarkdown(value: string) {
  return value
    .replace(/[#*_`>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
