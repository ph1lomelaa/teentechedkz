import { useQuery } from '@tanstack/react-query'
import { rewardRulesApi } from '@/api/rewardRules'

/** Действующие ставки вознаграждений + подписи, собранные из них.
 *
 * Единственная точка, через которую ставки попадают в UI: до этого проценты
 * этапов и суммы штрафов были захардкожены в TS отдельно от бэкенда, и после
 * правки регламента расходились с расчётом.
 *
 * ВАЖНО: эти подписи описывают ставку, действующую СЕЙЧАС, — им место в форме
 * создания начисления. Уже начисленные карточки обязаны показывать ставку из
 * своей строки (stage_pct / amount), иначе процент разъедется с суммой.
 */
export function useRewardRules() {
  const { data, isLoading } = useQuery({
    queryKey: ['reward-rules'],
    queryFn: rewardRulesApi.list,
    // Ставки меняют редко, а читают на каждом экране вознаграждений.
    staleTime: 5 * 60_000,
  })

  const stagePct = (stage: string): number | null => {
    const pct = data?.mentor_stage_pct?.[stage]?.pct
    return typeof pct === 'number' ? pct : null
  }

  const penaltyAmount = (color: string): number | null => {
    const amount = data?.mentor_task_penalty?.[color]?.amount
    return typeof amount === 'number' ? amount : null
  }

  const refundAmount = (level: string): number | null => {
    const amount = data?.refund_case_bonus?.[level]?.amount
    return typeof amount === 'number' ? amount : null
  }

  return {
    rules: data,
    isLoading,
    stagePct,
    penaltyAmount,
    refundAmount,
    mzkTiers: data?.mzk_quality_bonus?.default?.tiers ?? [],
    stagePctSum: data?.stage_pct_sum ?? 0,
    /** «Pre-Admission · 30%» — ставка, которая применится к новому начислению. */
    stageLabel: (stage: string, title: string) => {
      const pct = stagePct(stage)
      return pct === null ? title : `${title} · ${pct}%`
    },
    /** «Жёлтый · 2 500 ₸» */
    penaltyLabel: (color: string, title: string) => {
      const amount = penaltyAmount(color)
      return amount === null ? title : `${title} · ${formatTenge(amount)}`
    },
  }
}

export function formatTenge(amount: number): string {
  return `${amount.toLocaleString('ru-RU')} ₸`
}
