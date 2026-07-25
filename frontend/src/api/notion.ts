import apiClient from './client'

export type NotionMatchStatus = 'new' | 'linked' | 'ignored'

export interface NotionSnapshotItem {
  id: string
  notion_page_id: string
  notion_url?: string
  full_name?: string
  phone_normalized?: string
  suggested_student_id?: string
  suggested_student_name?: string
  suggested_confidence?: number
  student_id?: string
  status: NotionMatchStatus
  payment_status?: string
  intake?: string
  synced_at?: string
  notion_last_edited_at?: string
}

export type NotionSyncDirection = 'notion_newer' | 'crm_newer' | 'conflict' | 'unknown' | 'resolved'

export interface NotionComparisonRow {
  field: string
  label: string
  notion: string | null
  crm: string | null
  matches: boolean | null
  can_apply: boolean
  can_push: boolean
  // Какая сторона изменилась последней относительно эталона (для редактируемых полей).
  direction?: NotionSyncDirection
}

export interface NotionFinanceRow {
  label: string
  value: string
}

export interface StudentNotion {
  snapshot: NotionSnapshotItem | null
  comparison: NotionComparisonRow[]
  finance: NotionFinanceRow[]
}

export interface NotionSyncCounters {
  total: number
  created: number
  updated: number
  auto_linked: number
  needs_review: number
}

export interface NotionStatusInfo {
  configured: boolean
  last_run: {
    at: string | null
    ok: boolean | null
    error: string | null
    counters: NotionSyncCounters | null
  }
  needs_review: number
}

export interface NotionFinanceSummary {
  records: number
  synced_at: string | null
  totals: {
    client_fee: number
    client_remaining: number
    mentor_total: number
    mentor_paid: number
    mentor_tbp: number
    english_sum: number
    english_paid: number
    english_tbp: number
    up_sum: number
    up_paid: number
    up_tbp: number
    proforientation_sum: number
    ielts_exam_fee: number
    total_company: number
  }
  crm_totals: {
    client_remaining: number
    english_tbp: number
    mentor_tbp: number
    tbp_total: number
  }
  crm_known_count: number
  client_remaining_known_count: number
  client_remaining_total_count: number
  rows: {
    id: string
    student_id?: string | null
    full_name?: string | null
    payment_status: string
    intake?: string | null
    client_remaining_date?: string | null
    client_fee: number
    client_remaining: number
    client_remaining_filled?: boolean
    // CRM-расчёт (источник правды): null, если у студента нет договора в CRM.
    crm_client_remaining?: number | null
    crm_english_tbp?: number | null
    crm_mentor_tbp?: number | null
    crm_tbp_total?: number | null
    crm_client_paid?: number | null
    crm_mentor_paid?: number | null
    lead_mentor?: string | null
    mentors?: string[]
    mzk?: string | null
    mentor_total: number
    mentor_paid: number
    mentor_tbp: number
    english_sum: number
    english_paid: number
    english_tbp: number
    up_sum: number
    up_paid: number
    up_tbp: number
    proforientation_sum: number
    ielts_exam_fee: number
    total_company: number
    portfolio_status?: 'not_started' | 'in_progress' | 'completed' | null
    portfolio_achievements?: number | null
    portfolio_calls?: number | null
  }[]
  by_status: { status: string; count: number }[]
}

export const notionApi = {
  run: async () => {
    const res = await apiClient.post('/notion/run')
    return res.data as { ok: boolean; counters: NotionSyncCounters }
  },
  status: async () => {
    const res = await apiClient.get('/notion/status')
    return res.data as NotionStatusInfo
  },
  financeSummary: async () => {
    const res = await apiClient.get('/notion/finance-summary')
    return res.data as NotionFinanceSummary
  },
  snapshots: async (status: string = 'new') => {
    const res = await apiClient.get('/notion/snapshots', { params: { status } })
    return res.data as { items: NotionSnapshotItem[]; total: number }
  },
  link: async (snapshotId: string, studentId: string) => {
    const res = await apiClient.post(`/notion/snapshots/${snapshotId}/link`, { student_id: studentId })
    return res.data as NotionSnapshotItem
  },
  ignore: async (snapshotId: string) => {
    const res = await apiClient.post(`/notion/snapshots/${snapshotId}/ignore`)
    return res.data as NotionSnapshotItem
  },
  unlink: async (snapshotId: string) => {
    const res = await apiClient.post(`/notion/snapshots/${snapshotId}/unlink`)
    return res.data as NotionSnapshotItem
  },
  linkAll: async () => {
    const res = await apiClient.post('/notion/snapshots/link-all')
    return res.data as { ok: boolean; linked: number }
  },
  createStudent: async (snapshotId: string) => {
    const res = await apiClient.post(`/notion/snapshots/${snapshotId}/create-student`)
    return res.data as { student_id: string; snapshot: NotionSnapshotItem }
  },
  createMissing: async () => {
    const res = await apiClient.post('/notion/snapshots/create-missing')
    return res.data as { ok: boolean; created: number; skipped: number }
  },
  studentNotion: async (studentId: string) => {
    const res = await apiClient.get(`/notion/students/${studentId}`)
    return res.data as StudentNotion
  },
  applyField: async (studentId: string, field: string) => {
    const res = await apiClient.post(`/notion/students/${studentId}/apply-field`, { field })
    return res.data as { ok: boolean; field: string }
  },
  pushFieldPreview: async (studentId: string, field: string) => {
    const res = await apiClient.post(`/notion/students/${studentId}/push-field/preview`, { field })
    return res.data as {
      ok: boolean
      field: string
      real_name: string
      ptype: string
      will_write: string | number | null
      notion_current: string | number | null
      conflict: boolean
    }
  },
  pushField: async (studentId: string, field: string, force = false) => {
    const res = await apiClient.post(`/notion/students/${studentId}/push-field`, { field, force })
    return res.data as { ok: boolean; field: string; written: string }
  },
}
