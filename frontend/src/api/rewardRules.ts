import apiClient from './client'

export type RewardRuleKind =
  | 'mentor_stage_pct'
  | 'mentor_task_penalty'
  | 'mzk_quality_bonus'
  | 'refund_case_bonus'

export interface MzkTier {
  min_score_pct: number
  amount: number
}

/** payload зависит от вида ставки — формы описаны в схемах на бэкенде. */
export type RewardRulePayload =
  | { kind: 'mentor_stage_pct'; pct: number }
  | { kind: 'mentor_task_penalty'; amount: number }
  | { kind: 'refund_case_bonus'; amount: number }
  | { kind: 'mzk_quality_bonus'; tiers: MzkTier[] }

export interface RewardRule {
  id: string
  kind: RewardRuleKind
  rule_key: string
  payload: Record<string, unknown>
  version: number
  effective_from: string
  superseded_at: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

/** Действующие ставки, сгруппированные по виду. */
export interface RewardRulesResponse {
  mentor_stage_pct: Record<string, { pct?: number }>
  mentor_task_penalty: Record<string, { amount?: number }>
  mzk_quality_bonus: Record<string, { tiers?: MzkTier[] }>
  refund_case_bonus: Record<string, { amount?: number }>
  /** Сумма долей этапов — не блокируется, но показывается для контроля. */
  stage_pct_sum: number
}

export const rewardRulesApi = {
  list: async (): Promise<RewardRulesResponse> => {
    const response = await apiClient.get<RewardRulesResponse>('/reward-rules')
    return response.data
  },
  update: async (
    kind: RewardRuleKind,
    ruleKey: string,
    payload: RewardRulePayload,
    note?: string
  ): Promise<RewardRule> => {
    const response = await apiClient.put<RewardRule>(`/reward-rules/${kind}/${ruleKey}`, {
      payload,
      note: note || null,
    })
    return response.data
  },
  history: async (kind: RewardRuleKind, ruleKey: string): Promise<RewardRule[]> => {
    const response = await apiClient.get<RewardRule[]>(`/reward-rules/${kind}/${ruleKey}/history`)
    return response.data
  },
}
