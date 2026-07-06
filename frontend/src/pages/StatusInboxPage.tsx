import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { mentorAssignmentsApi, notesApi, pendingInsightsApi } from '@/api'
import { InsightCard } from '@/components/shared/InsightCard'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useState } from 'react'

export default function StatusInboxPage() {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'all' | 'mine'>('all')

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

  const pending = insights.filter((i) => i.status === 'pending')
  const resolved = insights.filter((i) => i.status !== 'pending')
  const actionableCount = pending.length + draftNotes.length

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
      <h1 className="text-xl font-semibold text-gray-900">Статус</h1>
      <p className="text-sm text-gray-500 max-w-3xl">
        Единая очередь изменений по студентам: Telegram-инсайты, контекстные заметки и черновики конспектов.
        Подтверждённые структурные изменения попадут в карточку, а планы и неподтверждённые детали сохранятся как заметки.
      </p>
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
                {draftNotes.map((note) => (
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
