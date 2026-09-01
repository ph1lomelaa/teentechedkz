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
import { DEGREE_LEVEL_LABELS, DegreeLevel } from '@/types'
import { QueryError } from '@/components/shared/QueryState'

export default function StatusInboxPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [directoryFilters, setDirectoryFilters] = useState<StudentDirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const directory = useStudentDirectory()

  const { data: insights = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pending-insights', 'all', scope],
    queryFn: () => pendingInsightsApi.listAll(undefined, scope),
  })

  const { data: draftNotes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['student-notes', 'draft', scope],
    queryFn: () => notesApi.list({ status: 'draft', scope }),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      pendingInsightsApi.review(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-insights'] })
      qc.invalidateQueries({ queryKey: ['student-notes'] })
      toast({ title: 'Инсайт обработан' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
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

  const matchesDirectory = useCallback(
    (studentId: string | null | undefined) =>
      matchesDirectoryFilters(studentId ? directory.byId.get(studentId) : undefined, directoryFilters),
    [directory.byId, directoryFilters],
  )

  const filteredInsights = useMemo(() => insights.filter((i) => matchesDirectory(i.student_id)), [insights, matchesDirectory])
  const filteredDraftNotes = useMemo(() => draftNotes.filter((n) => matchesDirectory(n.student_id)), [draftNotes, matchesDirectory])

  const pending = filteredInsights.filter((i) => i.status === 'pending')
  const resolved = filteredInsights.filter((i) => i.status !== 'pending')
  const actionableCount = pending.length + filteredDraftNotes.length

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

  const assignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-insights'] })
      toast({ title: 'Студент добавлен в ваши' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось взять студента', variant: 'destructive' }),
  })

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Кабинет ментора"
        title="Статус"
        description="Единая очередь изменений по студентам: Telegram-инсайты, контекстные заметки и черновики конспектов. Подтверждённые структурные изменения попадут в карточку, а планы и неподтверждённые детали сохранятся как заметки."
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

      {/* Пустые состояния здесь у каждой секции свои («Ничего не ждёт разбора»),
          поэтому isEmpty не передаём — иначе они подменились бы одним общим. */}
      {isError || directory.isError ? (
        <QueryError colorPrefix="w" error={error} onRetry={refetch} />
      ) : isLoading || notesLoading ? (
        <p className="text-sm text-w-muted">Загрузка…</p>
      ) : (
        <AppCard colorPrefix="w" className="space-y-6 p-5">
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-w-ink">На проверке ({actionableCount})</h2>
            {actionableCount === 0 ? (
              <div className="rounded-panel border border-w-line bg-w-panel2 p-6 text-center text-sm text-w-muted">Ничего не ждёт разбора</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredDraftNotes.map((note) => (
                  <AppCard key={note.id} colorPrefix="w" className="space-y-2 border-w-line bg-w-panel2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link to={`/notes/${note.id}`} className="text-w-accentText hover:underline">
                          {note.student_name || 'Без студента'}
                        </Link>
                        <p className="mt-1 font-bold text-w-ink">{note.title}</p>
                      </div>
                      <span className="rounded-pill border border-w-accentDim/40 bg-w-accent/10 px-1.5 py-0.5 text-[11px] text-w-accentText">
                        конспект
                      </span>
                    </div>
                    <p className="line-clamp-4 text-xs text-w-muted">
                      {stripMarkdown(note.summary_markdown)}
                    </p>
                    {Object.keys(note.suggested_changes || {}).length > 0 && (
                      <p className="text-xs text-w-muted2">
                        Есть предложения к полям карточки: {Object.keys(note.suggested_changes).join(', ')}
                      </p>
                    )}
                    <div className="flex gap-1.5 pt-1">
                      <AppButton
                        size="sm"
                        variant="subtle"
                        disabled={noteReviewMutation.isPending}
                        onClick={() => noteReviewMutation.mutate({ id: note.id, action: 'approve' })}
                      >
                        Подтвердить
                      </AppButton>
                      <AppButton
                        size="sm"
                        variant="subtle"
                        disabled={noteReviewMutation.isPending}
                        onClick={() => noteReviewMutation.mutate({ id: note.id, action: 'reject' })}
                      >
                        Отклонить
                      </AppButton>
                      <AppButton size="sm" variant="subtle" onClick={() => navigate(`/notes/${note.id}`)}>
                        Открыть
                      </AppButton>
                    </div>
                  </AppCard>
                ))}
                {pending.map((insight) => (
                  <div key={insight.id} className="space-y-2">
                    <InsightCard
                      insight={insight}
                      showStudentLink
                      isPending={reviewMutation.isPending}
                      onApprove={() => reviewMutation.mutate({ id: insight.id, action: 'approve' })}
                      onReject={() => reviewMutation.mutate({ id: insight.id, action: 'reject' })}
                    />
                    {!insight.is_mine && (
                      <AppButton
                        variant="subtle"
                        size="sm"
                        disabled={assignSelfMutation.isPending}
                        onClick={() => assignSelfMutation.mutate(insight.student_id)}
                      >
                        Взять студента
                      </AppButton>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {resolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-w-ink">Разобранные ({resolved.length})</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {resolved.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    showStudentLink
                    onApprove={() => {}}
                    onReject={() => {}}
                  />
                ))}
              </div>
            </section>
          )}
        </AppCard>
      )}
    </div>
  )
}

function stripMarkdown(value: string) {
  return value
    .replace(/[#*_`>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
