import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Participation } from '@/api/activities'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'

export const myPlanKey = ['activities', 'plan', 'mine'] as const

export function useMyPlan() {
  return useQuery({ queryKey: myPlanKey, queryFn: () => activitiesApi.plan() })
}

/** activity_id → участие ученика (последнее, если наборов несколько). */
export function participationByActivity(plan: Participation[] | undefined): Map<string, Participation> {
  const map = new Map<string, Participation>()
  for (const item of [...(plan ?? [])].reverse()) map.set(item.activity.id, item)
  return map
}

/**
 * «Добавить в план». Если участие уже есть (рекомендация или «не интересно»),
 * меняем решение, а не создаём новое: POST вернул бы существующее как есть,
 * и рекомендация так и осталась бы нерешённой. Повторный клик ничего не плодит —
 * бэкенд держит одну запись на ученика и набор.
 */
export function useAddToPlan() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ intakeId, existing }: { intakeId: string; existing?: Participation }) => {
      if (existing && ['completed', 'cancelled'].includes(existing.status)) throw new Error('Участие закрыто. Обсудите новый набор с ментором.')
      if (existing && existing.decision !== 'selected') {
        return activitiesApi.editPlan(existing.id, { decision: 'selected' }, true)
      }
      return activitiesApi.select(intakeId)
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['activities'] })
      toast({ title: 'Добавлено в ваш план', description: 'Это ещё не регистрация у организатора — шаги подскажет ментор.' })
    },
    onError: (error) => toast({ title: getErrorMessage(error), variant: 'destructive' }),
  })
}

export function useDecline() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (item: Participation) => activitiesApi.editPlan(item.id, { decision: 'not_interested' }, true),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['activities'] })
      toast({ title: 'Отметили: не интересно', description: 'Ментор увидит ваш ответ.' })
    },
    onError: (error) => toast({ title: getErrorMessage(error), variant: 'destructive' }),
  })
}
