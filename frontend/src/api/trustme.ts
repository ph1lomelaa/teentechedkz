import apiClient from './client'

export interface ContractDetails {
  name: string; contract_number: string; contract_date: string | null; signed_date: string | null
  customer_name: string; student_name: string; signed_confirmed?: boolean
}
export interface TrustMeCandidate {
  reason?: string
  blocked?: boolean
  source?: 'trustme' | 'manual'
  signed_date?: string | null
  signed_date_source?: string | null
  contract_date?: string | null
  legal_number?: string | null
  customer_name?: string | null
  student_name?: string | null
  external_id?: string
  short_url: string | null
  name: string
  number: string | null
  status: number
  created_at: string | null
  signers: { name: string | null; signed: boolean; is_company: boolean }[]
}

export interface TrustMeLink extends TrustMeCandidate {
  id: string
  financial_contract_id?: string | null
  linked_at: string
}

export interface ContractDiscovery { state: 'pending' | 'complete' | 'unavailable'; linked_ids: string[]; review: TrustMeCandidate[]; partial?: boolean; checked_at?: string }

export interface RegistryItem {
  id: string; number: string | null; name: string; decision: 'review' | 'unmatched' | 'unreadable'; reason: string | null
  status: number; created_at: string | null; checked_at: string; student_name: string | null; customer_name: string | null
  candidates: { id: string; full_name: string }[]
}
export interface TrustMeRegistry { counts: Record<string, number>; items: RegistryItem[] }

export interface TrustMeSearch {
  candidates: TrustMeCandidate[]
  queries: string[]
  truncated: boolean
}

const base = (studentId: string) => `/trustme/students/${studentId}`

export const trustmeApi = {
  autoLink: async (studentId: string) =>
    (await apiClient.post<ContractDiscovery>(`${base(studentId)}/auto-link`, null, { timeout: 100000 })).data,
  list: async (studentId: string) =>
    (await apiClient.get<TrustMeLink[]>(`${base(studentId)}/links`)).data,
  search: async (studentId: string, query: string, aliases: string[], mode: 'name' | 'text' | 'auto' = 'auto') =>
    (await apiClient.post<TrustMeSearch>(`${base(studentId)}/search`, { query, aliases, mode })).data,
  resolve: async (studentId: string, reference: string) =>
    (await apiClient.post<TrustMeCandidate>(`${base(studentId)}/resolve`, { reference })).data,
  upload: async (studentId: string, file: File, name: string, signed: boolean) => {
    const data = new FormData()
    data.append('file', file); data.append('name', name); data.append('identity_confirmed', 'true'); data.append('signed_confirmed', String(signed))
    return (await apiClient.post<TrustMeLink>(`${base(studentId)}/upload`, data, { timeout: 120000, headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
  inspect: async (studentId: string, id: string) =>
    (await apiClient.post<import('./acts').ContractInspection>(`${base(studentId)}/links/${id}/inspect`, null, { timeout: 120000 })).data,
  details: async (studentId: string, id: string, details: ContractDetails) =>
    (await apiClient.patch<TrustMeLink>(`${base(studentId)}/links/${id}/details`, details)).data,
  link: async (studentId: string, short_url: string) =>
    (await apiClient.post<TrustMeLink>(`${base(studentId)}/links`, { short_url, identity_confirmed: true })).data,
  assignFinancial: async (studentId: string, linkId: string, financial_contract_id: string | null) =>
    (await apiClient.patch<TrustMeLink>(`${base(studentId)}/links/${linkId}/financial-contract`, { financial_contract_id })).data,
  unlink: async (studentId: string, linkId: string) =>
    apiClient.delete(`${base(studentId)}/links/${linkId}`),
  registry: async () => (await apiClient.get<TrustMeRegistry>('/trustme/registry')).data,
  registryPdf: async (docId: string) => (await apiClient.get<Blob>(`/trustme/registry/${docId}/pdf`, { responseType: 'blob' })).data,
  registryLink: async (docId: string, student_id: string) =>
    (await apiClient.post<{ link_id: string }>(`/trustme/registry/${docId}/link`, { student_id }, { timeout: 120000 })).data,
  registryDismiss: async (docId: string) => apiClient.post(`/trustme/registry/${docId}/dismiss`),
  pdf: async (studentId: string, shortUrl: string) => {
    try {
      return (await apiClient.get<Blob>(`${base(studentId)}/pdf/${encodeURIComponent(shortUrl)}`, { responseType: 'blob' })).data
    } catch (error) {
      const response = (error as { response?: { data?: unknown } }).response
      if (response?.data instanceof Blob) {
        try { response.data = JSON.parse(await response.data.text()) } catch { /* Retain the original error. */ }
      }
      throw error
    }
  },
}
