import apiClient from './client'

export type MentorStageKind = 'pre_admission' | 'admission' | 'post_admission'
export type PenaltyColor = 'yellow' | 'orange' | 'red'

export interface MentorStageReward {
  id: string
  student_id: string
  mentor_id: string
  mentor_name: string | null
  stage: MentorStageKind
  stage_pct: number
  total_contract_amount: number
  computed_amount: number
  accepted: boolean
  accepted_by: string | null
  accepted_at: string | null
  created_at: string
}

export interface MentorTaskPenalty {
  id: string
  mentor_id: string
  mentor_name: string | null
  task_id: string | null
  color: PenaltyColor
  amount: number
  recorded_at: string
  recorded_by: string | null
  contested: boolean
  contest_note: string | null
}

export const mentorRewardsApi = {
  listStageRewards: async (params?: { mentor_id?: string; student_id?: string }): Promise<{ items: MentorStageReward[]; pilot: boolean }> => {
    const response = await apiClient.get<{ items: MentorStageReward[]; pilot: boolean }>('/mentor-stage-rewards', { params })
    return response.data
  },
  createStageReward: async (data: { student_id: string; mentor_id: string; stage: MentorStageKind; total_contract_amount: number }): Promise<MentorStageReward> => {
    const response = await apiClient.post<MentorStageReward>('/mentor-stage-rewards', data)
    return response.data
  },
  acceptStageReward: async (id: string): Promise<MentorStageReward> => {
    const response = await apiClient.patch<MentorStageReward>(`/mentor-stage-rewards/${id}/accept`, {})
    return response.data
  },
  listTaskPenalties: async (mentor_id?: string): Promise<{ items: MentorTaskPenalty[] }> => {
    const response = await apiClient.get<{ items: MentorTaskPenalty[] }>('/mentor-task-penalties', { params: { mentor_id } })
    return response.data
  },
  createTaskPenalty: async (data: { mentor_id: string; task_id?: string; color: PenaltyColor }): Promise<MentorTaskPenalty> => {
    const response = await apiClient.post<MentorTaskPenalty>('/mentor-task-penalties', data)
    return response.data
  },
  contestTaskPenalty: async (id: string, note: string): Promise<MentorTaskPenalty> => {
    const response = await apiClient.patch<MentorTaskPenalty>(`/mentor-task-penalties/${id}/contest`, { note })
    return response.data
  },
}
