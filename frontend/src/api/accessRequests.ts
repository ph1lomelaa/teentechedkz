import apiClient from './client'

/** Карточка-кандидат из подсказки матчинга. */
export interface SuggestedStudent {
  id: string
  full_name: string
  phone: string
  intake_year: number | null
  /** У карточки ещё нет кабинета. Занятую привязывать нельзя. */
  is_free: boolean
}

export interface AccessRequestItem {
  id: string
  user: { id: string; email: string; name: string; is_active: boolean }
  requested_role: 'student' | 'mentor'
  full_name: string
  phone: string
  city: string | null
  direction: string | null
  suggested_student: SuggestedStudent | null
  confidence: number | null
  method: string | null
  method_label: string | null
  status: string
  created_at: string
}

export interface MyAccessRequest {
  id: string
  requested_role: 'student' | 'mentor'
  full_name: string
  phone: string
  city: string | null
  direction: string | null
  status: string
  created_at: string
}

export interface BulkApproveResult {
  approved: { id: string; name: string; student_id: string }[]
  /** Кого не взяли и почему. Показывать обязательно — молчание читается как
   *  «очередь разобрана», хотя половина осталась. */
  skipped: { id: string; name?: string; reason: string }[]
}

export const accessRequestsApi = {
  list: async (status = 'new'): Promise<{ items: AccessRequestItem[]; total_new: number }> => {
    const response = await apiClient.get('/access-requests', { params: { status_filter: status } })
    return response.data
  },
  count: async (): Promise<{ total: number }> => {
    const response = await apiClient.get('/access-requests/count')
    return response.data
  },
  /** Своя заявка. Единственная ручка очереди, доступная ждущему аккаунту. */
  mine: async (): Promise<MyAccessRequest | null> => {
    const response = await apiClient.get('/access-requests/mine')
    return response.data
  },
  approve: async (id: string, body: { role: string; student_id?: string }) => {
    const response = await apiClient.post(`/access-requests/${id}/approve`, body)
    return response.data
  },
  reject: async (id: string) => {
    const response = await apiClient.post(`/access-requests/${id}/reject`)
    return response.data
  },
  createStudent: async (id: string) => {
    const response = await apiClient.post(`/access-requests/${id}/create-student`)
    return response.data
  },
  bulkApprove: async (ids: string[]): Promise<BulkApproveResult> => {
    const response = await apiClient.post('/access-requests/bulk-approve', { ids })
    return response.data
  },
}
