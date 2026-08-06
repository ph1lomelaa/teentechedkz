import apiClient from './client'

export type RefundLevel = 'yellow' | 'orange' | 'red'
export type RefundCaseStatus = 'draft' | 'submitted' | 'registered' | 'under_review' | 'awaiting_documents' | 'awaiting_approval' | 'negotiation' | 'decision_made' | 'awaiting_execution' | 'executed' | 'rejected' | 'closed'

export interface RefundCase {
  id: string
  contract_id: string | null
  student_id: string | null
  mzk_manager_id: string
  mzk_manager_name: string | null
  amount: number | null
  applicant_name: string | null
  payer_name: string | null
  reason: string | null
  provided_services: string[]
  outstanding_obligations: string[]
  specialist_explanations: string | null
  correspondence: string | null
  calculation: string | null
  level_criteria: Record<string, boolean>
  level: RefundLevel | null
  bonus_amount: number | null
  level_approved_by: string | null
  level_approved_at: string | null
  status: RefundCaseStatus
  opened_at: string
  resolved_at: string | null
  resolution_summary: string | null
  decision: string | null
  approval_note: string | null
  approved_by: string | null
  approved_at: string | null
  execution_confirmation: string | null
  bonus_paid_at: string | null
}

export const refundCasesApi = {
  list: async (status?: RefundCaseStatus): Promise<{ items: RefundCase[] }> => {
    const response = await apiClient.get<{ items: RefundCase[] }>('/refund-cases', { params: { status } })
    return response.data
  },
  create: async (data: { student_id?: string; contract_id?: string; mzk_manager_id?: string; amount?: number; applicant_name?: string; payer_name?: string; reason?: string; provided_services?: string[]; outstanding_obligations?: string[] }): Promise<RefundCase> => {
    const response = await apiClient.post<RefundCase>('/refund-cases', data)
    return response.data
  },
  setLevel: async (id: string, level: RefundLevel): Promise<RefundCase> => {
    const response = await apiClient.patch<RefundCase>(`/refund-cases/${id}/level`, { level })
    return response.data
  },
  resolve: async (id: string, resolution_summary: string, decision: string, execution_confirmation: string): Promise<RefundCase> => {
    const response = await apiClient.patch<RefundCase>(`/refund-cases/${id}/resolve`, { resolution_summary, decision, execution_confirmation })
    return response.data
  },
  approve: async (id: string, decision: string, approval_note: string): Promise<RefundCase> => {
    const response = await apiClient.patch<RefundCase>(`/refund-cases/${id}/approve`, { decision, approval_note })
    return response.data
  },
  markBonusPaid: async (id: string): Promise<RefundCase> => {
    const response = await apiClient.patch<RefundCase>(`/refund-cases/${id}/bonus-paid`)
    return response.data
  },
}
