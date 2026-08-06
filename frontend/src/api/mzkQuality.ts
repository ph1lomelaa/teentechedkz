import apiClient from './client'

export interface MzkReview {
  id: string
  mzk_manager_id: string
  mzk_manager_name: string | null
  period_year: number
  period_month: number
  is_positive: boolean
  is_valid: boolean
  invalidated_reason: string | null
  source_kind: string
  source_key: string
  source_user_id: string | null
  created_at: string
}

export interface MzkQualityScore {
  id: string
  mzk_manager_id: string
  mzk_manager_name: string | null
  period_year: number
  period_month: number
  valid_reviews_count: number
  positive_reviews_count: number
  score_pct: number
  bonus_amount: number
  disqualified: boolean
  disqualified_reason: string | null
  approved_by: string | null
  approved_at: string | null
  objection_text: string | null
  objection_deadline: string | null
  computed_at: string
}

export const mzkQualityApi = {
  createReview: async (data: { mzk_manager_id: string; period_year: number; period_month: number; is_positive: boolean; source_kind: string; source_key: string }): Promise<MzkReview> => {
    const response = await apiClient.post<MzkReview>('/mzk-quality/reviews', data)
    return response.data
  },
  listReviews: async (mzk_manager_id?: string): Promise<{ items: MzkReview[] }> => {
    const response = await apiClient.get<{ items: MzkReview[] }>('/mzk-quality/reviews', { params: { mzk_manager_id } })
    return response.data
  },
  invalidateReview: async (id: string, reason: string): Promise<MzkReview> => {
    const response = await apiClient.patch<MzkReview>(`/mzk-quality/reviews/${id}/invalidate`, { reason })
    return response.data
  },
  listScores: async (mzk_manager_id?: string): Promise<{ items: MzkQualityScore[] }> => {
    const response = await apiClient.get<{ items: MzkQualityScore[] }>('/mzk-quality/scores', { params: { mzk_manager_id } })
    return response.data
  },
  computeScore: async (data: { mzk_manager_id: string; period_year: number; period_month: number }): Promise<MzkQualityScore> => {
    const response = await apiClient.post<MzkQualityScore>('/mzk-quality/scores/compute', data)
    return response.data
  },
  disqualifyScore: async (id: string, reason: string): Promise<MzkQualityScore> => {
    const response = await apiClient.patch<MzkQualityScore>(`/mzk-quality/scores/${id}/disqualify`, { reason })
    return response.data
  },
  approveScore: async (id: string): Promise<MzkQualityScore> => {
    const response = await apiClient.patch<MzkQualityScore>(`/mzk-quality/scores/${id}/approve`)
    return response.data
  },
  createObjection: async (id: string, text: string): Promise<MzkQualityScore> => {
    const response = await apiClient.post<MzkQualityScore>(`/mzk-quality/scores/${id}/objection`, { text })
    return response.data
  },
}
