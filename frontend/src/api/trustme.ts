import apiClient from './client'

export interface TrustMeCandidate {
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

export interface TrustMeSearch {
  candidates: TrustMeCandidate[]
  queries: string[]
  truncated: boolean
}

const base = (studentId: string) => `/trustme/students/${studentId}`

export const trustmeApi = {
  list: async (studentId: string) =>
    (await apiClient.get<TrustMeLink[]>(`${base(studentId)}/links`)).data,
  search: async (studentId: string, query: string, aliases: string[]) =>
    (await apiClient.post<TrustMeSearch>(`${base(studentId)}/search`, { query, aliases })).data,
  link: async (studentId: string, short_url: string) =>
    (await apiClient.post<TrustMeLink>(`${base(studentId)}/links`, { short_url, identity_confirmed: true })).data,
  assignFinancial: async (studentId: string, linkId: string, financial_contract_id: string | null) =>
    (await apiClient.patch<TrustMeLink>(`${base(studentId)}/links/${linkId}/financial-contract`, { financial_contract_id })).data,
  unlink: async (studentId: string, linkId: string) =>
    apiClient.delete(`${base(studentId)}/links/${linkId}`),
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
