import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pendingInsightsApi } from '@/api'
import { InsightCard } from '@/components/shared/InsightCard'
import { toast } from '@/hooks/use-toast'

export default function StatusInboxPage() {
  const qc = useQueryClient()

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ['pending-insights', 'all'],
    queryFn: () => pendingInsightsApi.listAll(),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      pendingInsightsApi.review(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-insights'] })
      toast({ title: 'Инсайт обработан' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const pending = insights.filter((i) => i.status === 'pending')
  const resolved = insights.filter((i) => i.status !== 'pending')

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Статус</h1>
      <p className="text-sm text-gray-500">
        Наблюдения от AI по переписке со студентами — как то, что попало в структурные поля профиля, так и то, что
        не удалось сопоставить ни с одним полем и требует ручного просмотра.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Загрузка…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-gray-700">На проверке ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-gray-500">Ничего не ждёт разбора</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pending.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    showStudentLink
                    isPending={reviewMutation.isPending}
                    onApprove={() => reviewMutation.mutate({ id: insight.id, action: 'approve' })}
                    onReject={() => reviewMutation.mutate({ id: insight.id, action: 'reject' })}
                  />
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
