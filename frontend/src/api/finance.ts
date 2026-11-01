import apiClient from './client'

/** Раздел «Финансы». Суммы — строки Decimal с бэкенда, как во всём финансовом API. */
export type ScheduleState = 'paid' | 'overdue' | 'today' | 'upcoming'
export type ScheduleKind = 'main' | 'english' | 'portfolio' | 'proforientation' | 'ielts_fee' | 'other'
export type PaymentMethod = 'kaspi' | 'bank' | 'cash' | 'other'
export type FinanceChangeStatus = 'new' | 'accepted' | 'kept'

export interface ScheduleItem {
  id: string
  contract_id: string
  student_id: string
  student_name: string
  mzk_name: string | null
  pipeline_status: string | null
  kind: ScheduleKind
  label: string | null
  amount: string
  paid: string
  left: string
  currency: string
  due_date: string
  state: ScheduleState
  days_overdue: number
  note: string | null
  /** Последняя оплата по строке. */
  method: PaymentMethod | null
  paid_at: string | null
  /** null — оплат по строке ещё нет. */
  has_receipt: boolean | null
  /** Только во вкладке «Просрочены»: когда МЗК последний раз напомнили. */
  reminded_at?: string | null
}

export interface FinanceChange {
  id: string
  student_id: string
  student_name: string
  mzk_name: string | null
  contract_id: string | null
  field: string
  field_label: string
  /** «Notion» или «Платформа · Имя». */
  where: string
  old_value: string | null
  new_value: string | null
  old_label: string
  new_label: string
  notified: boolean
  source: string
  status: FinanceChangeStatus
  schedule_item_id: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
}

export interface ReceivedPayment {
  id: string
  contract_id: string
  student_name: string
  amount: string
  currency: string
  paid_at: string | null
  method: PaymentMethod | null
  schedule_item_id: string | null
  kind: ScheduleKind | null
  label: string | null
  note: string | null
  has_receipt: boolean
  recorded_by: string | null
}

export interface TodayView {
  today: string
  due_today: ScheduleItem[]
  /** Пять самых старых просрочек; всего — overdue_count. */
  overdue: ScheduleItem[]
  overdue_count: number
  overdue_total: string
  /** Пять последних непроверенных правок из Notion; всего — changes_count. */
  changes: FinanceChange[]
  changes_count: number
  month_received: string
  month_planned: string
  /** Договоры с остатком и датой в Notion, но без графика. */
  notion_import_count: number
}

export interface FinanceCounters {
  due_today: number
  overdue: number
  new_changes: number
  no_receipt: number
  review: number
}

export type NextPaymentKind = 'overdue' | 'today' | 'planned' | 'not_planned' | 'paid_full'

export interface FinanceContractRow {
  trustme_count?: number
  acts_count?: number
  contract_id: string
  student_id: string
  student_name: string
  intake_year: number | null
  pipeline_status: string | null
  mzk_name: string | null
  currency: string
  amount: string | null
  paid: string
  remaining: string | null
  next_payment: { kind: NextPaymentKind; item: ScheduleItem | null }
}

export interface ContractsPage {
  items: FinanceContractRow[]
  total: number
  page: number
  size: number
  mzk_options: string[]
  intake_options: number[]
}

export interface FinanceContractDetail extends FinanceContractRow {
  signed_date: string | null
  source: string
  synced_at: string | null
  scheduled: string
  undistributed: string | null
  schedule: ScheduleItem[]
  payments: ReceivedPayment[]
  changes: FinanceChange[]
}

export interface Discrepancy {
  contract_id: string
  student_name: string
  currency: string
  remaining: string
  scheduled: string
  undistributed: string
}

export interface FinanceMailDelivery {
  id: string; student_id: string; contract_id: string | null; recipient: string; subject: string; status: string; attempts: number; last_error: string | null; created_at: string
}

export interface ReviewView {
  changes: FinanceChange[]
  no_receipt: ReceivedPayment[]
  discrepancies: Discrepancy[]
}

export interface ScheduleItemInput {
  contract_id: string
  kind: ScheduleKind
  label?: string | null
  amount: string
  due_date: string
  note?: string | null
}

export interface PayInput {
  amount: string
  paid_at: string
  method: PaymentMethod
  note?: string | null
}

export interface ContractsQuery {
  documents?: string
  q?: string
  status?: string
  mzk?: string
  intake?: number | ''
  /** mismatch — график не равен остатку, none — графика нет. */
  schedule?: '' | 'mismatch' | 'none'
  page?: number
}

export const financeKeys = {
  all: ['finance'] as const,
  today: () => ['finance', 'today'] as const,
  counters: () => ['finance', 'counters'] as const,
  expected: () => ['finance', 'expected'] as const,
  overdue: () => ['finance', 'overdue'] as const,
  received: (from: string, to: string) => ['finance', 'received', from, to] as const,
  schedule: (from: string, to: string) => ['finance', 'schedule', from, to] as const,
  contracts: (q: ContractsQuery) => ['finance', 'contracts', q] as const,
  contract: (id: string | undefined) => ['finance', 'contract', id] as const,
  review: () => ['finance', 'review'] as const,
}

export const financeApi = {
  deliveries: async (): Promise<FinanceMailDelivery[]> => (await apiClient.get('/finance/mail-deliveries')).data,
  resolveDelivery: async (id: string, outcome: string, note: string): Promise<FinanceMailDelivery> => (await apiClient.post(`/finance/mail-deliveries/${id}/resolve`, { outcome, note })).data,
  today: async (): Promise<TodayView> => (await apiClient.get('/finance/today')).data,
  counters: async (): Promise<FinanceCounters> => (await apiClient.get('/finance/counters')).data,
  expected: async (): Promise<ScheduleItem[]> => (await apiClient.get('/finance/expected')).data,
  overdue: async (): Promise<ScheduleItem[]> => (await apiClient.get('/finance/overdue')).data,
  received: async (dateFrom: string, dateTo: string): Promise<ReceivedPayment[]> =>
    (await apiClient.get('/finance/received', { params: { date_from: dateFrom, date_to: dateTo } })).data,
  schedule: async (dateFrom: string, dateTo: string): Promise<ScheduleItem[]> =>
    (await apiClient.get('/finance/schedule', { params: { date_from: dateFrom, date_to: dateTo } })).data,
  contracts: async (q: ContractsQuery): Promise<ContractsPage> => {
    const params: Record<string, string | number> = { page: q.page ?? 1 }
    if (q.q) params.q = q.q
    if (q.status) params.status = q.status
    if (q.mzk) params.mzk = q.mzk
    if (q.intake) params.intake = q.intake
    if (q.schedule) params.schedule = q.schedule
    if (q.documents) params.documents = q.documents
    return (await apiClient.get('/finance/contracts', { params })).data
  },
  contract: async (id: string): Promise<FinanceContractDetail> => (await apiClient.get(`/finance/contracts/${id}`)).data,
  review: async (): Promise<ReviewView> => (await apiClient.get('/finance/review')).data,
  createItem: async (data: ScheduleItemInput): Promise<ScheduleItem> => (await apiClient.post('/finance/schedule', data)).data,
  updateItem: async (id: string, data: Partial<Omit<ScheduleItemInput, 'contract_id'>>): Promise<ScheduleItem> =>
    (await apiClient.patch(`/finance/schedule/${id}`, data)).data,
  deleteItem: async (id: string): Promise<void> => {
    await apiClient.delete(`/finance/schedule/${id}`)
  },
  pay: async (id: string, data: PayInput): Promise<ScheduleItem & { payment_id: string }> =>
    (await apiClient.post(`/finance/schedule/${id}/pay`, data)).data,
  uploadReceipt: async (paymentId: string, file: File): Promise<{ id: string; file_name: string }> => {
    const form = new FormData()
    form.append('file', file)
    return (await apiClient.post(`/finance/payments/${paymentId}/receipt`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },
  remind: async (id: string): Promise<{ ok: boolean; already_sent: boolean }> =>
    (await apiClient.post(`/finance/schedule/${id}/remind`)).data,
  acceptChange: async (id: string, moveSchedule = false): Promise<{ ok: boolean; moved_item_id: string | null }> =>
    (await apiClient.post(`/finance/changes/${id}/accept`, { move_schedule: moveSchedule })).data,
  notionImport: async (): Promise<{ created: number }> => (await apiClient.post('/finance/notion-import')).data,
  rejectChange: async (id: string): Promise<{ ok: boolean }> => (await apiClient.post(`/finance/changes/${id}/reject`)).data,
}
