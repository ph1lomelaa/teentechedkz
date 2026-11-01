import api from './client'

export const ACT_TEMPLATES = {
  portfolio: 'Портфолио', ielts: 'IELTS', profile: 'Оценка профиля',
  stages: 'Несколько этапов', final: 'Итоговый акт',
} as const
export type ActTemplate = keyof typeof ACT_TEMPLATES
export interface ActLine {
  name: string; result: string; evidence: string; contract_source: string
  quantity: string; unit: string; unit_price: string | null
}
export interface ActInput {
  contract_link_id: string; supersedes_id: string | null; template: ActTemplate
  student_name: string; customer_name: string; customer_id: string; student_id_number: string
  executor_name: string; executor_representative: string; executor_basis: string; executor_requisites: string
  contract_number: string; contract_date: string; act_date: string; city: string
  period_start: string; period_end: string; calls_count: number | null
  include_amount: boolean; currency: 'KZT' | 'RUB' | 'USD' | 'EUR'; lines: ActLine[]
  verified: boolean; full_completion_confirmed: boolean
}
export interface ActMail { id: string; recipient: string; subject: string; status: string; created_at: string }
export interface ActRecord {
  id: string; status: 'draft' | 'ready'; file_name: string | null; student_name: string
  template: ActTemplate; act_date: string; created_at: string; shared: boolean
  supersedes_id: string | null; snapshot: ActInput; mail: ActMail[]
  author_name?: string | null
}
export interface ActContract { id: string; name: string; number: string | null; status: number; short_url: string; financial_contract_id?: string | null; signers: { name: string | null; is_company: boolean; signed: boolean }[] }
export interface ActContext {
  unassigned_contracts?: ActContract[]
  financial_contracts?: { id: string; label: string }[]
  student_name: string; completed_meetings: number | null; mail_configured: boolean
  recipient_suggestions: string[]
  contracts: { id: string; name: string; number: string | null; status: number; short_url: string; financial_contract_id?: string | null;
    signers: { name: string | null; is_company: boolean; signed: boolean }[] }[]
  acts: ActRecord[]
}
export interface ContractInspection {
  pages: { page: number; text: string }[]; suggested_contract_number: string | null
  signers: { name: string | null; is_company: boolean; signed: boolean }[]
}
export interface RegistryRow { student_id: string; student_name: string; contracts_count: number; acts_count: number; drafts_count: number }
export interface RegistryFilters { q: string; kind: string; mail_status: string; responsible_id: string; date_from: string; date_to: string; page: number }

async function blobRequest(request: Promise<{ data: Blob }>): Promise<Blob> {
  try { return (await request).data } catch (error) {
    const response = (error as { response?: { data?: unknown } }).response
    if (response?.data instanceof Blob) {
      try { response.data = JSON.parse(await response.data.text()) } catch { /* Preserve original response. */ }
    }
    throw error
  }
}
export const actsApi = {
  registry: async (filters: RegistryFilters) => (await api.get<{ total: number; items: RegistryRow[] }>('/acts/registry', {
    params: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
  })).data,
  responsibles: async () => (await api.get<{ id: string; name: string }[]>('/acts/responsibles')).data,
  financialContext: async (id: string) => (await api.get<ActContext>(`/finance/contracts/${id}/documents`)).data,
  context: async (sid: string, period?: { period_start: string; period_end: string }) =>
    (await api.get<ActContext>(`/acts/students/${sid}`, { params: period })).data,
  contractPdf: (sid: string, id: string) => blobRequest(api.get(`/acts/students/${sid}/contracts/${id}/pdf`, { responseType: 'blob' })),
  inspect: async (sid: string, id: string) => (await api.post<ContractInspection>(`/acts/students/${sid}/contracts/${id}/inspect`)).data,
  preview: (sid: string, input: ActInput) => blobRequest(api.post(`/acts/students/${sid}/preview`, input, { responseType: 'blob' })),
  create: async (sid: string, input: ActInput) => (await api.post<ActRecord>(`/acts/students/${sid}`, input)).data,
  update: async (id: string, input: ActInput) => (await api.put<ActRecord>(`/acts/${id}`, input)).data,
  generate: async (id: string) => (await api.post<ActRecord>(`/acts/${id}/generate`)).data,
  pdf: (id: string) => blobRequest(api.get(`/acts/${id}/pdf`, { responseType: 'blob' })),
  share: async (id: string) => (await api.post(`/acts/${id}/share`)).data,
  send: async (id: string, input: { request_id: string; recipient: string; subject: string; body: string }) =>
    (await api.post<ActMail>(`/acts/${id}/send`, input)).data,
  resolveMail: async (id: string, attempt: string, outcome: string, note: string) =>
    (await api.post<ActMail>(`/acts/${id}/mail/${attempt}/resolve`, { outcome, note })).data,
  portalList: async () => (await api.get<ActRecord[]>('/acts/portal/mine')).data,
  portalPdf: (id: string) => blobRequest(api.get(`/acts/portal/${id}/pdf`, { responseType: 'blob' })),
}
