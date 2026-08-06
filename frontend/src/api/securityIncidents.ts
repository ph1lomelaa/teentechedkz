import apiClient from './client'

export type SecurityIncidentKind = 'wrong_document' | 'data_leak' | 'compromised_password' | 'lost_device' | 'wrong_access' | 'unknown_chat_member'
export type SecurityIncidentStatus = 'open' | 'investigating' | 'resolved' | 'closed'

export interface SecurityIncident {
  id: string
  kind: SecurityIncidentKind
  status: SecurityIncidentStatus
  title: string
  description: string
  evidence: string | null
  remediation: string | null
  owner_id: string | null
  created_by: string
  resolved_by: string | null
  resolved_at: string | null
  closed_at: string | null
  created_at: string
}

export const securityIncidentsApi = {
  list: async (status?: SecurityIncidentStatus): Promise<{ items: SecurityIncident[] }> => {
    const response = await apiClient.get<{ items: SecurityIncident[] }>('/security-incidents', { params: { status } })
    return response.data
  },
  create: async (data: { kind: SecurityIncidentKind; title: string; description: string; evidence?: string }): Promise<SecurityIncident> => {
    const response = await apiClient.post<SecurityIncident>('/security-incidents', data)
    return response.data
  },
  update: async (id: string, data: { status?: SecurityIncidentStatus; evidence?: string; remediation?: string }): Promise<SecurityIncident> => {
    const response = await apiClient.patch<SecurityIncident>(`/security-incidents/${id}`, data)
    return response.data
  },
}
