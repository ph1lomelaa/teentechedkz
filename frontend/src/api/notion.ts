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

export interface NotionComparisonRow {
  field: string
  label: string
  notion: string | null
  crm: string | null
  matches: boolean | null
  can_apply: boolean
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
}
