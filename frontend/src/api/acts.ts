import api from './client'

export const ACT_TEMPLATES = {
  portfolio: 'Портфолио', ielts: 'IELTS', profile: 'Оценка профиля',
  stages: 'Акт оказанных услуг', final: 'Итоговый акт', career: 'Профориентация', applications: 'Подачи в университеты', offer: 'Получение оффера', admission: 'Поступление — итоговый акт',
} as const
export type ActTemplate = keyof typeof ACT_TEMPLATES
export interface ActLine {
  contract_service_id?: string; source_fingerprint?: string
  name: string; result: string; evidence: string; contract_source: string
  quantity: string; unit: string; unit_price: string | null
}
export interface ActInput {
  contract_link_id: string; supersedes_id: string | null; template: ActTemplate
  student_name: string; customer_name: string; customer_id: string; student_id_number: string
  customer_email?: string
  executor_name: string; executor_representative: string; executor_basis: string; executor_requisites: string
  contract_number: string; contract_date: string; act_date: string; city: string
  period_start: string; period_end: string; calls_count: number | null
  include_amount: boolean; contract_total?: string | null; currency: 'KZT' | 'RUB' | 'USD' | 'EUR'; lines: ActLine[]
  verified: boolean; full_completion_confirmed: boolean; company_signature?: boolean; application_ids?: string[]; verified_outcomes?: string[]; previous_act_references?: string[]
}
export interface ActMail { id: string; recipient: string; subject: string; status: string; created_at: string }
export interface ActRecord {
  id: string; status: 'draft' | 'ready'; file_name: string | null; student_name: string
  template: ActTemplate; act_date: string; created_at: string; shared: boolean
  supersedes_id: string | null; snapshot: ActInput; mail: ActMail[]
  author_name?: string | null
}
export interface ActContract { source?: 'trustme' | 'manual'; signed_date?: string | null; signed_date_source?: string | null; customer_name?: string | null; student_name?: string | null; legal_number?: string | null; contract_date?: string | null; id: string; name: string; number: string | null; status: number; short_url: string; financial_contract_id?: string | null; signers: { name: string | null; is_company: boolean; signed: boolean }[] }
export interface ActContext {
  unassigned_contracts?: ActContract[]
  financial_contracts?: { id: string; label: string }[]
  student_name: string; completed_meetings: number | null; mail_configured: boolean
  recipient_suggestions: string[]
  contracts: ActContract[]
  acts: ActRecord[]
}
export interface ContractService { source_kind?: 'standard'; id: string; name: string; category: string; text: string; page: number; reference: string; excerpt: string; confirmed_price?: { amount: string; currency: ActInput['currency'] } }
export interface ContractInspection {
  applications?: { id: string; university: string | null; program: string | null; status: string }[]
  fingerprint?: string; services?: ContractService[]; company_signature_available?: boolean
  contract_amount?: string | null; contract_currency?: string | null
  signed_date?: string | null; signed_date_source?: string | null
  status: number
  fields: Partial<Record<keyof ActInput, string>>
  sources: Record<string, { kind: string; page: number | null; excerpt: string }>
  conflicts: Record<string, { value: string; page: number | null; kind: string }[]>
  missing: string[]
  service_hints: Partial<Record<ActTemplate, { page: number; reference: string; confirmed_price: { amount: string; currency: ActInput['currency']; page: number } | null }>>
  pages: { page: number; text: string; ocr?: boolean; ocr_skipped?: boolean }[]; suggested_contract_number: string | null
  signers: { name: string | null; is_company: boolean; signed: boolean }[]
}
export interface RegistryRow { student_id: string; student_name: string; contracts_count: number; acts_count: number; drafts_count: number }
export type ActCellState = 'sent' | 'ready' | 'missing' | 'none'
export interface ActCell { state: ActCellState; act_id?: string; date?: string | null; file_name?: string | null }
export interface ActsTableRow {
  student_id: string; full_name: string; phone: string | null; status: string | null; intake: number | null; degree: string | null
  responsibles: { id: string; name: string; role: string }[]; mzk: { id: string; name: string } | null; mine: boolean
  contracts: { id: string; number: string | null; name: string; status: number; source?: string; financial_contract_id: string | null }[]
  services_total: number; services_closed: number; percent: number | null; cells: Record<string, ActCell>
}
export interface ActsTable { columns: { key: string; label: string }[]; rows: ActsTableRow[] }
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
  table: async () => (await api.get<ActsTable>('/acts/table')).data,
  responsibles: async () => (await api.get<{ id: string; name: string }[]>('/acts/responsibles')).data,
  financialContext: async (id: string) => (await api.get<ActContext>(`/finance/contracts/${id}/documents`)).data,
  context: async (sid: string, period?: { period_start: string; period_end: string }) =>
    (await api.get<ActContext>(`/acts/students/${sid}`, { params: period })).data,
  contractPdf: (sid: string, id: string) => blobRequest(api.get(`/acts/students/${sid}/contracts/${id}/pdf`, { responseType: 'blob' })),
  checkContract: async (sid: string, id: string) => (await api.post<{ status: number; checked_at: string; signed_date?: string | null; signed_date_source?: string | null }>(`/acts/students/${sid}/contracts/${id}/status`)).data,
  inspect: async (sid: string, id: string, refresh = false) => (await api.post<ContractInspection>(`/acts/students/${sid}/contracts/${id}/inspect`, null, { params: { refresh } })).data,
  addServiceQuote: async (sid: string, id: string, data: { page: number; text: string; category: string }) => (await api.post<ContractService>(`/acts/students/${sid}/contracts/${id}/service-quote`, data)).data,
  saveProfile: async (sid: string, id: string, fields: Record<string, string>) => (await api.patch(`/acts/students/${sid}/contracts/${id}/profile`, { fields })).data,
  preview: (sid: string, input: ActInput) => blobRequest(api.post(`/acts/students/${sid}/preview`, input, { responseType: 'blob' })),
  create: async (sid: string, input: ActInput) => (await api.post<ActRecord>(`/acts/students/${sid}`, input)).data,
  update: async (id: string, input: ActInput) => (await api.put<ActRecord>(`/acts/${id}`, input)).data,
  remove: async (id: string) => { await api.delete(`/acts/${id}`) },
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
