import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { mentorAssignmentsApi, notesApi, pendingInsightsApi } from '@/api'
import { InsightCard } from '@/components/shared/InsightCard'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { useMemo, useState } from 'react'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
import { FilterPopover, FilterField, FilterChips, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory, matchesDirectoryFilters, EMPTY_DIRECTORY_FILTERS, StudentDirectoryFilters } from '@/hooks/useStudentDirectory'
import { DEGREE_LEVEL_LABELS, DegreeLevel } from '@/types'

export default function StatusInboxPage() {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [directoryFilters, setDirectoryFilters] = useState<StudentDirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const directory = useStudentDirectory()

  const { data: insights = [], isLoading } = useQuery({
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

  const matchesDirectory = (studentId: string | null | undefined) =>
    matchesDirectoryFilters(studentId ? directory.byId.get(studentId) : undefined, directoryFilters)

  const filteredInsights = useMemo(() => insights.filter((i) => matchesDirectory(i.student_id)), [insights, directoryFilters, directory.byId])
  const filteredDraftNotes = useMemo(() => draftNotes.filter((n) => matchesDirectory(n.student_id)), [draftNotes, directoryFilters, directory.byId])

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
    <div className="space-y-6">
      <CrmPageHeader
        eyebrow="Проверка"
        title="Статус"
        description="Единая очередь изменений по студентам: Telegram-инсайты, контекстные заметки и черновики конспектов. Подтверждённые структурные изменения попадут в карточку, а планы и неподтверждённые детали сохранятся как заметки."
      />
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { value: 'all', label: 'Все' },
          { value: 'mine', label: 'Мои' },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setScope(item.value as typeof scope)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              scope === item.value
                ? 'border-black text-gray-900 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
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

      <FilterChips chips={filterChips} onResetAll={resetDirectoryFilters} />

      {isLoading || notesLoading ? (
        <p className="text-sm text-gray-500">Загрузка…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-gray-700">На проверке ({actionableCount})</h2>
            {actionableCount === 0 ? (
              <p className="text-sm text-gray-500">Ничего не ждёт разбора</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredDraftNotes.map((note) => (
                  <div key={note.id} className="border border-gray-100 rounded-[2px] p-3 text-sm space-y-2 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link to={`/notes/${note.id}`} className="text-blue-600 hover:underline">
                          {note.student_name || 'Без студента'}
                        </Link>
                        <p className="font-medium text-gray-900 mt-1">{note.title}</p>
                      </div>
                      <span className="px-1.5 py-0.5 rounded-[2px] text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                        конспект
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-4">
                      {stripMarkdown(note.summary_markdown)}
                    </p>
                    {Object.keys(note.suggested_changes || {}).length > 0 && (
                      <p className="text-xs text-gray-500">
                        Есть предложения к полям карточки: {Object.keys(note.suggested_changes).join(', ')}
                      </p>
                    )}
                    <div className="flex gap-1.5 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={noteReviewMutation.isPending}
                        onClick={() => noteReviewMutation.mutate({ id: note.id, action: 'approve' })}
                      >
                        Подтвердить
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={noteReviewMutation.isPending}
                        onClick={() => noteReviewMutation.mutate({ id: note.id, action: 'reject' })}
                      >
                        Отклонить
                      </Button>
                      <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                        <Link to={`/notes/${note.id}`}>Открыть</Link>
                      </Button>
                    </div>
                  </div>
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
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={assignSelfMutation.isPending}
                        onClick={() => assignSelfMutation.mutate(insight.student_id)}
                      >
                        Взять студента
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {resolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-gray-700">Разобранные ({resolved.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </>
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
