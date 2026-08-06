import apiClient from './client'

export type AddendumStatus =
  | 'draft' | 'sent_to_customer' | 'customer_signed' | 'company_signed'
  | 'active' | 'renewal_due' | 'completed' | 'cancelled'

export interface ContractAddendum {
  id: string
  contract_id: string
  student_id: string
  number: string
  reason: string
  current_intake: string | null
  new_intake: string | null
  country_name: string | null
  programs: string[]
  transfer_start: string | null
  transfer_end: string | null
  resume_date: string | null
  contract_expires_at: string | null
  related_service_ids: string[]
  related_task_ids: string[]
  status: AddendumStatus
  version: number
  document_hash: string | null
  customer_signed_by: string | null
  customer_signed_at: string | null
  company_signed_by: string | null
  company_signed_at: string | null
  created_at: string
}

export const contractAddendaApi = {
  listByStudent: async (studentId: string): Promise<ContractAddendum[]> => {
    const response = await apiClient.get<ContractAddendum[]>(`/contract-addenda/student/${studentId}`)
    return response.data
  },
  create: async (data: Record<string, unknown>): Promise<ContractAddendum> => {
    const response = await apiClient.post<ContractAddendum>('/contract-addenda', data)
    return response.data
  },
  send: async (id: string): Promise<ContractAddendum> => {
    const response = await apiClient.post<ContractAddendum>(`/contract-addenda/${id}/send`)
    return response.data
  },
  signCustomer: async (id: string): Promise<ContractAddendum> => {
    const response = await apiClient.post<ContractAddendum>(`/contract-addenda/${id}/sign/customer`)
    return response.data
  },
  signCompany: async (id: string): Promise<ContractAddendum> => {
    const response = await apiClient.post<ContractAddendum>(`/contract-addenda/${id}/sign/company`)
    return response.data
  },
}
