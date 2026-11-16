import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { financeApi, financeKeys } from '@/api/finance'

/**
 * Режим раздела «Финансы» (решение 15.11.2026). В режиме «только просмотр»
 * финансист ничего не вносит: кнопки ввода скрыты, остаётся «Просмотрено».
 * Пока ответа нет — считаем режим включённым (безопаснее спрятать кнопки).
 */
export function useFinanceMode() {
  const { can } = useAuth()
  const { data } = useQuery({ queryKey: financeKeys.counters(), queryFn: financeApi.counters, staleTime: 60_000 })
  const viewOnly = data?.view_only ?? true
  const manage = can('finance_desk', 'manage')
  // 16.11: оффер срок не ставит — просрочки «после оффера» не бывает.
  const offerDeadline = data?.offer_deadline ?? false
  return { viewOnly, offerDeadline, canEdit: manage && !viewOnly, canMarkSeen: manage }
}
