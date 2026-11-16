import apiClient from './client'

/** Раздел «Финансы». Суммы — строки Decimal с бэкенда, как во всём финансовом API. */
export type ScheduleState = 'paid' | 'overdue' | 'today' | 'upcoming' | 'cancelled' | 'after_offer'
export type ScheduleKind = 'main' | 'english' | 'portfolio' | 'proforientation' | 'ielts_fee' | 'other'
export type PaymentMethod = 'kaspi' | 'bank' | 'cash' | 'other'
export type FinanceChangeStatus = 'new' | 'accepted' | 'kept'

export interface ScheduleItem {
  id: string
  /** Страница ученика в Notion (есть в «Долгах»). */
  notion_url?: string | null
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
  /** null — строка «после оффера», оффера ещё нет. */
  due_date: string | null
  after_offer?: boolean
  state: ScheduleState
  days_overdue: number
  note: string | null
  /** Последняя оплата по строке. */
  method: PaymentMethod | null
  paid_at: string | null
  /** null — оплат по строке ещё нет. */
  has_receipt: boolean | null
  /** На «Платежах»: обещание нарушено; последнее действие по долгу. */
  promise_broken?: boolean
  last_action?: DebtAction | null
  /** Только во вкладке «Просрочены»: когда МЗК последний раз напомнили. */
  reminded_at?: string | null
  /** Платёж отменён (не удалён): виден в истории карточки зачёркнутым. */
  cancelled_at?: string | null
  cancel_reason?: string | null
}

export interface FinanceChange {
  id: string
  notion_url?: string | null
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
  /** paid или cancelled (отменённая видна в истории зачёркнутой). */
  status?: 'paid' | 'cancelled'
  payer?: Payer | null
  cancelled_at?: string | null
  cancel_reason?: string | null
  /** Куда легла оплата; есть только в карточке договора. */
  allocations?: PaymentAllocationRow[]
  /** Нераспределённая часть — аванс клиента. */
  advance?: string | null
}

export type Payer = 'student' | 'parent' | 'other'
export const PAYER_LABELS: Record<Payer, string> = { student: 'Ученик', parent: 'Родитель', other: 'Другое' }

export interface PaymentAllocationRow {
  schedule_item_id: string
  kind: ScheduleKind
  label: string | null
  due_date: string | null
  amount: string
}

export interface AllocationPreview {
  parts: Array<PaymentAllocationRow & { after_offer: boolean; closes: boolean; left_after: string }>
  advance: string
}

export interface JournalEntry {
  at: string
  what: string
  old: string | null
  new: string | null
  who: string | null
  source: 'platform' | 'notion'
}

export interface DebtAction {
  id: string
  kind: string
  label: string
  text: string
  at: string
  who: string | null
  promise_date: string | null
  promise_amount: string | null
}

export interface DebtRow extends ScheduleItem {
  stage: string
  responsible: string
  last_action: DebtAction | null
  promise: DebtAction | null
  promise_broken: boolean
  awaiting_mzk: boolean
  /** Договор этого МЗК — он может ответить на напоминание. */
  mine: boolean
}

export interface RefundRow {
  id: string
  contract_id: string | null
  student_name: string | null
  stage: 'Запрошен' | 'Согласован' | 'Выплачен' | 'Отклонён'
  status: string
  reason: string | null
  requested: string | null
  approved: string | null
  decision: string | null
  opened_at: string | null
  approved_at: string | null
  paid_at: string | null
  paid_amount: string | null
  contract_paid: string | null
  services_closed: number | null
  services_total: number | null
  mentor_paid: string | null
}

export interface MonthStatus {
  month: string
  closed_at: string | null
  closed_by: string | null
  by_method: Array<{ method: string; total: string }>
  payments: Array<{ id: string; contract_id: string; student_name: string; paid_at: string; amount: string; refund: boolean; method: PaymentMethod | null; has_receipt: boolean; reconciled: boolean }>
  unreconciled: number
  no_receipt: number
}

export interface FinancePrefs {
  urgent: string[]
  summary_hour: number
  summary: boolean
  urgent_options?: Array<{ key: string; label: string }>
  address?: string | null
  away_from?: string | null
  away_to?: string | null
  deputy_id?: string | null
  deputy_options?: Array<{ id: string; name: string; role: string }>
}

export interface FinanceSearchHit {
  contract_id: string
  student_name: string
  phone: string | null
  mzk_name: string | null
  number: string | null
  remaining: string | null
  currency: string
  pipeline_status: string | null
}

export interface NotionMismatch {
  contract_id: string
  student_id: string
  student_name: string
  mzk_name: string | null
  currency: string
  amount: string
  notion_remaining: string
  by_payments: string
  difference: string
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
  month_totals?: Array<{ currency: string; received: string; planned: string }>
  month_received: string
  month_planned: string
  /** Договоры с остатком и датой в Notion, но без графика. */
  notion_import_count: number
  /** Ждут проверки: правки из Notion + оплаты без чека. */
  review_count?: number
  due_today_total?: string
  /** Ближайший ожидаемый платёж — для пустого дня. */
  next_expected?: ScheduleItem | null
  expected_count?: number
  expected_total?: string
  /** Режим «только просмотр»: остаток есть, оффера ещё нет. */
  waiting_offer_count?: number
  waiting_offer_total?: string
  /** Согласованные, но не выплаченные возвраты. */
  refunds_to_pay?: RefundRow[]
  /** Обещали оплатить сегодня (задание 8). */
  promised_today?: Array<ScheduleItem & { promise: DebtAction }>
  /** Последние данные из Notion; плашка, если старше 30 минут. */
  notion_synced_at?: string | null
}

export interface FinanceCounters {
  /** Дел на сегодня: оплаты со сроком сегодня + офферы, где остаток не выставлен. */
  today_tasks?: number
  /** Режим «только просмотр» (15.11): кнопки ввода скрыты. */
  view_only?: boolean
  /** Отметка оффера ставит срок оплаты (16.11: по умолчанию нет). */
  offer_deadline?: boolean
  offers_waiting?: number
  due_today: number
  overdue: number
  new_changes: number
  no_receipt: number
  review: number
}

export type NextPaymentKind = 'overdue' | 'today' | 'planned' | 'not_planned' | 'paid_full' | 'after_offer' | 'offer_received'

export interface OriginalDocument { kind: 'trustme' | 'scan'; id: string; label: string }

export interface FinanceContractRow {
  notion_url?: string | null
  trustme_count?: number
  acts_count?: number
  trustme?: { id: string; number: string | null; status: number; source?: string }[]
  /** Настоящий договор: TrustMe этого договора → TrustMe ученика без привязки → скан договора. */
  originals?: OriginalDocument[]
  services_total?: number
  services_closed?: number
  closed_percent?: number | null
  contract_id: string
  student_id: string
  student_name: string
  intake_year: number | null
  pipeline_status: string | null
  degree?: string | null
  /** Есть строка «после оффера» без даты. */
  waiting_offer?: boolean
  /** Номер договора из поля договора (ведут МЗК и админ). */
  number?: string | null
  /** Остаток «по оплатам», если в Notion он больше. */
  by_payments?: string | null
  /** Остаток не совпадает с графиком (график уже ведётся). */
  schedule_mismatch?: boolean
  mzk_name: string | null
  currency: string
  amount: string | null
  paid: string
  recorded_paid?: string
  historical_paid?: string
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
  /** Единая лента денег по договору: оплаты, график, чеки, Notion. */
  journal?: JournalEntry[]
  phone?: string | null
  /** Вкладка «Долг»: действия по просроченным платежам. */
  debt_actions?: DebtAction[]
  /** Сканы допсоглашений (загружает МЗК). */
  addenda?: Array<{ id: string; label: string }>
  documents_checked_at?: string | null
  documents_checked_by?: string | null
  /** Акты по услугам договора: нужен / создан / отправлен (ведёт МЗК). */
  act_cells?: Array<{ service: string; state: 'missing' | 'ready' | 'sent'; label: string; date: string | null }>
  /** Суммы по услугам из Notion: основная, английский, УП, профориентация, IELTS. */
  services?: Array<{ service: string; amount: string | null; paid: string | null; remaining: string | null }>
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
  total?: number; pending_total?: number; offset?: number; limit?: number
  changes: FinanceChange[]
  no_receipt: ReceivedPayment[]
  discrepancies: Discrepancy[]
  /** В Notion остаток больше, чем по оплатам (решение 1 = А). */
  notion_mismatches?: NotionMismatch[]
  view_only?: boolean
  /** Оплачены, а акта по услугам нет: «Напомнить МЗК». */
  no_act?: Array<{ contract_id: string; student_name: string; mzk_name: string | null; missing: number; total: number }>
  /** Договоры с остатком, но без графика: «Расписать график». */
  no_schedule?: Array<{ contract_id: string; student_name: string; mzk_name: string | null; currency: string; remaining: string; remaining_date: string | null }>
}

export interface ScheduleItemInput {
  operation_key?: string
  contract_id: string
  kind: ScheduleKind
  label?: string | null
  amount: string
  /** null — «после оффера». */
  due_date: string | null
  after_offer?: boolean
  note?: string | null
}

export interface PayInput {
  amount: string
  paid_at: string
  method: PaymentMethod
  payer?: Payer | null
  note?: string | null
  /** «Похоже, эта оплата уже внесена. Всё равно добавить?» — да. */
  confirm_duplicate?: boolean
}

export interface PaymentPatch {
  amount?: string
  paid_at?: string
  method?: PaymentMethod
  payer?: Payer | null
  note?: string | null
  reason: string
  confirm_duplicate?: boolean
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
  size?: number
}

export interface ActsSummary {
  active_total: number; active_without_trustme: number; active_without_acts: number; active_average_percent: number | null
  month: { created: number; sent: number; not_sent: number }
  paid_not_closed: { contract_id: string; student_name: string; closed_percent: number | null; services_closed: number; services_total: number }[]
  paid_not_closed_total: number
}

/** «Оффер получен — закрыть остаток»: оффер в заявке ученика, по договору ещё остаток. */
export interface OfferDue {
  notion_url?: string | null
  contract_id: string
  student_id: string
  student_name: string
  university: string
  offers: number
  enrolled: boolean
  offer_at: string | null
  amount: string | null
  paid: string | null
  remaining: string
  remaining_date: string | null
  currency: string
  /** Остаток «по оплатам», если в Notion остаток больше: менеджер не обновил его после оплаты. */
  by_payments: string | null
  /** «Выставить» нажат: когда и кем. */
  issued_at?: string | null
  issued_by?: string | null
}

export const financeKeys = {
  all: ['finance'] as const,
  notionImportPreview: () => ['finance', 'notion-import'] as const,
  today: () => ['finance', 'today'] as const,
  counters: () => ['finance', 'counters'] as const,
  expected: () => ['finance', 'expected'] as const,
  overdue: () => ['finance', 'overdue'] as const,
  received: (from: string, to: string) => ['finance', 'received', from, to] as const,
  schedule: (from: string, to: string) => ['finance', 'schedule', from, to] as const,
  contracts: (q: ContractsQuery) => ['finance', 'contracts', q] as const,
  contract: (id: string | undefined) => ['finance', 'contract', id] as const,
  review: (status = 'all', offset = 0) => ['finance', 'review', status, offset] as const,
  actsSummary: () => ['finance', 'acts-summary'] as const,
  offersDue: () => ['finance', 'offers-due'] as const,
}

export const financeApi = {
  deliveries: async (): Promise<FinanceMailDelivery[]> => (await apiClient.get('/finance/mail-deliveries')).data,
  resolveDelivery: async (id: string, outcome: string, note: string): Promise<FinanceMailDelivery> => (await apiClient.post(`/finance/mail-deliveries/${id}/resolve`, { outcome, note })).data,
  actsSummary: async (): Promise<ActsSummary> => (await apiClient.get('/finance/acts-summary')).data,
  offersDue: async (): Promise<{ items: OfferDue[]; total: number }> => (await apiClient.get('/finance/offers-due')).data,
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
    if (q.size) params.size = q.size
    if (q.q) params.q = q.q
    if (q.status) params.status = q.status
    if (q.mzk) params.mzk = q.mzk
    if (q.intake) params.intake = q.intake
    if (q.schedule) params.schedule = q.schedule
    if (q.documents) params.documents = q.documents
    return (await apiClient.get('/finance/contracts', { params })).data
  },
  contractScan: async (contractId: string, docId: string): Promise<Blob> =>
    (await apiClient.get(`/finance/contracts/${contractId}/scan/${docId}`, { responseType: 'blob' })).data,
  contract: async (id: string): Promise<FinanceContractDetail> => (await apiClient.get(`/finance/contracts/${id}`)).data,
  review: async (status = 'all', offset = 0): Promise<ReviewView> => (await apiClient.get('/finance/review', { params: { status, offset, limit: 500 } })).data,
  createItem: async (data: ScheduleItemInput): Promise<ScheduleItem> => (await apiClient.post('/finance/schedule', data)).data,
  updateItem: async (id: string, data: Partial<Omit<ScheduleItemInput, 'contract_id'>>): Promise<ScheduleItem> =>
    (await apiClient.patch(`/finance/schedule/${id}`, data)).data,
  cancelItem: async (id: string, reason: string): Promise<ScheduleItem> =>
    (await apiClient.post(`/finance/schedule/${id}/cancel`, { reason })).data,
  previewPayment: async (contractId: string, data: { amount: string; schedule_item_id?: string | null; payment_id?: string | null }): Promise<AllocationPreview> =>
    (await apiClient.post(`/finance/contracts/${contractId}/payments/preview`, data)).data,
  addPayment: async (contractId: string, data: PayInput & { schedule_item_id?: string | null }): Promise<AllocationPreview & { payment_id: string }> =>
    (await apiClient.post(`/finance/contracts/${contractId}/payments`, data)).data,
  updatePayment: async (id: string, data: PaymentPatch): Promise<void> => { await apiClient.patch(`/finance/payments/${id}`, data) },
  cancelPayment: async (id: string, reason: string): Promise<void> => { await apiClient.post(`/finance/payments/${id}/cancel`, { reason }) },
  planSchedule: async (contractId: string, data: { operation_key: string; rows: Array<{ amount: string; due_date?: string | null; after_offer?: boolean; label?: string | null }> }): Promise<{ created: number; repeated: boolean }> =>
    (await apiClient.post(`/finance/contracts/${contractId}/schedule/plan`, data)).data,
  search: async (q: string): Promise<FinanceSearchHit[]> => (await apiClient.get('/finance/search', { params: { q } })).data,
  offerSeen: async (contractId: string): Promise<{ seen: number }> => (await apiClient.post(`/finance/offers/${contractId}/seen`)).data,
  issueOffer: async (contractId: string): Promise<{ due_date: string; dated_items: number; created_item: string | null }> =>
    (await apiClient.post(`/finance/offers/${contractId}/issue`)).data,
  documentsChecked: async (contractId: string): Promise<{ documents_checked_at: string; documents_checked_by: string }> =>
    (await apiClient.post(`/finance/contracts/${contractId}/documents-checked`)).data,
  remindAct: async (contractId: string): Promise<{ ok: boolean; already: boolean }> =>
    (await apiClient.post(`/finance/contracts/${contractId}/remind-act`)).data,
  debts: async (): Promise<{ items: DebtRow[]; stages: Array<{ stage: string; count: number; total: string }> }> =>
    (await apiClient.get('/finance/debts')).data,
  debtAction: async (itemId: string, data: { kind: 'contact' | 'promise' | 'escalated' | 'reschedule'; channel?: string | null; with_whom?: string | null; result?: string | null; promise_date?: string | null; promise_amount?: string | null; new_due?: string | null }): Promise<DebtAction> =>
    (await apiClient.post(`/finance/debts/${itemId}/actions`, data)).data,
  mzkReply: async (itemId: string, data: { answer: 'promised' | 'no_answer' | 'refund'; promise_date?: string | null; promise_amount?: string | null; note?: string | null }): Promise<DebtAction> =>
    (await apiClient.post(`/finance/debts/${itemId}/mzk-reply`, data)).data,
  refunds: async (): Promise<{ items: RefundRow[] }> => (await apiClient.get('/finance/refunds')).data,
  refundPayout: async (id: string, data: { amount: string; paid_at: string; method: PaymentMethod; note?: string | null }): Promise<{ payment_id: string; cancelled_items: number }> =>
    (await apiClient.post(`/finance/refunds/${id}/payout`, data)).data,
  reportSummary: async (): Promise<Record<string, string | number>> => (await apiClient.get('/finance/reports/summary')).data,
  reportIncome: async (params: { date_from: string; date_to: string; by: string }): Promise<{ rows: Array<{ month: string; group: string; plan: string; fact: string; refunds: string; net: string }> }> =>
    (await apiClient.get('/finance/reports/income', { params })).data,
  reportAging: async (by: string): Promise<{ buckets: string[]; rows: Array<{ group: string; buckets: Array<{ bucket: string; count: number; total: string }>; total: string }>; total: string }> =>
    (await apiClient.get('/finance/reports/aging', { params: { by } })).data,
  reportOffers: async (params: { date_from: string; date_to: string }): Promise<{ offers: number; contracts: number; issued: number; collected: number; avg_days_to_payment: number | null }> =>
    (await apiClient.get('/finance/reports/offers', { params })).data,
  monthStatus: async (month: string): Promise<MonthStatus> => (await apiClient.get(`/finance/reports/months/${month}`)).data,
  reconcile: async (ids: string[], reconciled = true): Promise<void> => { await apiClient.post('/finance/reports/reconcile', { ids, reconciled }) },
  closeMonth: async (month: string, force = false): Promise<void> => { await apiClient.post(`/finance/reports/months/${month}/close`, { force }) },
  prefs: async (): Promise<FinancePrefs> => (await apiClient.get('/finance/prefs')).data,
  savePrefs: async (data: { urgent: string[]; summary_hour: number; summary: boolean; away_from?: string | null; away_to?: string | null; deputy_id?: string | null }): Promise<FinancePrefs> =>
    (await apiClient.put('/finance/prefs', data)).data,
  remindNotion: async (contractId: string): Promise<{ ok: boolean; already: boolean }> =>
    (await apiClient.post(`/finance/contracts/${contractId}/remind-notion`)).data,
  allocatePayment: async (id: string, scheduleItemId: string): Promise<void> => { await apiClient.post(`/finance/payments/${id}/allocate`, { schedule_item_id: scheduleItemId }) },
  pay: async (id: string, data: PayInput): Promise<ScheduleItem & { payment_id: string; advance?: string }> =>
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
  acceptChanges: async (ids: string[]): Promise<{ ok: boolean; accepted: number }> =>
    (await apiClient.post('/finance/changes/accept-many', { ids })).data,
  notionImportPreview: async (): Promise<{ count: number; total: string }> => (await apiClient.get('/finance/notion-import')).data,
  notionImport: async (): Promise<{ created: number }> => (await apiClient.post('/finance/notion-import')).data,
  rejectChange: async (id: string): Promise<{ ok: boolean }> => (await apiClient.post(`/finance/changes/${id}/reject`)).data,
}
