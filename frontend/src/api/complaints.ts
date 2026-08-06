import apiClient from './client'

export type ComplaintKind = 'complaint' | 'recommendation'
export type ComplaintStatus = 'new' | 'in_progress' | 'answered' | 'closed'
export type ComplaintVisibility = 'admin_only' | 'admin_and_mzk' | 'all_mentors'
export type ComplaintCategory = 'student' | 'parent' | 'deadline' | 'quality' | 'specialist_change' | 'communication' | 'refund' | 'suggestion' | 'other'
export type ComplaintRiskLevel = 'normal' | 'high'

export interface ComplaintReply {
  id: string
  author_user_id: string
  author_name: string | null
  body: string
  created_at: string
}

export interface Complaint {
  id: string
  author_user_id: string
  author_name: string | null
  student_id: string | null
  student_name: string | null
  kind: ComplaintKind
  applicant_type: 'student' | 'parent' | 'employee' | 'other'
  category: ComplaintCategory
  subject: string
  body: string
  original_body: string
  intermediate_answer: string | null
  final_answer: string | null
  decision: string | null
  confirmation: string | null
  status: ComplaintStatus
  assigned_to: string | null
  assignee_name: string | null
  visible_to_role: ComplaintVisibility
  created_at: string
  first_response_at: string | null
  resolved_at: string | null
  is_sla_breached: boolean
  risk_level: ComplaintRiskLevel
  legal_escalated_at: string | null
  legal_escalation_reason: string | null
  replies?: ComplaintReply[]
}

export const complaintsApi = {
  list: async (params?: {
    status?: ComplaintStatus
    kind?: ComplaintKind
    student_id?: string
    sla_breached?: boolean
    /** UUID, or the literal "me" — resolved server-side. */
    assigned_to?: string
  }): Promise<{ items: Complaint[] }> => {
    const response = await apiClient.get<{ items: Complaint[] }>('/complaints', { params })
    return response.data
  },
  get: async (id: string): Promise<Complaint> => {
    const response = await apiClient.get<Complaint>(`/complaints/${id}`)
    return response.data
  },
  create: async (data: { kind: ComplaintKind; category?: ComplaintCategory; applicant_type?: Complaint['applicant_type']; subject: string; body: string; student_id?: string }): Promise<Complaint> => {
    const response = await apiClient.post<Complaint>('/complaints', data)
    return response.data
  },
  update: async (id: string, data: Partial<{ status: ComplaintStatus; assigned_to: string | null; visible_to_role: ComplaintVisibility; intermediate_answer: string; final_answer: string; decision: string; confirmation: string }>): Promise<Complaint> => {
    const response = await apiClient.patch<Complaint>(`/complaints/${id}`, data)
    return response.data
  },
  reply: async (id: string, body: string): Promise<Complaint> => {
    const response = await apiClient.post<Complaint>(`/complaints/${id}/replies`, { body })
    return response.data
  },
}
