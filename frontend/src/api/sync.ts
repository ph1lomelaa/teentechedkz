import apiClient from './client'

export type IntakeSource = 'package' | 'cases'
export type IntakeSubmissionStatus = 'new' | 'linked' | 'ignored'

export interface IntakeSubmission {
  id: string
  source: IntakeSource
  submitted_at?: string
  full_name?: string
  phone_normalized?: string
  manager_name?: string
  suggested_student_id?: string
  suggested_student_name?: string
  suggested_confidence?: number
  match_candidate_ids?: string[]
  match_candidate_names?: string[]
  identity_review_required?: boolean
  content_revision?: number
  student_id?: string
  status: IntakeSubmissionStatus
  raw_data: Record<string, string>
  created_at: string
}

export interface BulkLinkResult {
  ok: boolean
  linked: number
  skipped: number
}

export interface ComparisonRow {
  field: string
  label: string
  package?: string
  cases?: string
  crm?: string
  mismatch: boolean | null
  human_only: boolean
  crm_matches: boolean | null
  ai_same_meaning: boolean | null
  ai_note: string | null
  crm_ai_same_meaning: boolean | null
  crm_ai_note: string | null
}

export interface StudentIntake {
  package: IntakeSubmission | null
  cases: IntakeSubmission | null
  comparison: ComparisonRow[]
}

/** Счётчики одного листа формы. */
export interface SheetCounters {
  total_rows: number
  new: number
  matched: number
}

/** Сколько анкет синк сам превратил в карточки общей базы (и сколько отдал человеку). */
export interface PromotedCounters {
  created: number
  skipped: number
  /** Проход упёрся в потолок — очередь разберётся следующими синками. */
  has_more: boolean
}

/** Ключи — источники (`package`/`cases`), плюс отдельный `promoted`: у него
 *  другая форма, поэтому обходить это как однородную карту нельзя. */
export interface SyncCounters extends Record<string, SheetCounters | PromotedCounters | undefined> {
  promoted?: PromotedCounters
}

export interface SyncStatusInfo {
  configured: boolean
  last_run: {
    at: string | null
    ok: boolean | null
    error: string | null
    counters: SyncCounters | null
  }
  new_submissions: number
}

export type NotionFieldSyncStatus = 'pending' | 'processing' | 'dry_run' | 'succeeded' | 'resolved' | 'conflict' | 'failed' | 'superseded'
export interface NotionFieldSyncItem {
  id: string
  student_id: string | null
  student_name: string | null
  notion_page_id: string
  field_key: string
  direction: string
  status: NotionFieldSyncStatus
  crm_value: string | number | null
  notion_value: string | number | null
  baseline_value: string | number | null
  has_baseline: boolean
  reason: string | null
  last_error: string | null
  attempts: number
  updated_at: string | null
}
export interface NotionFieldSyncQueue {
  enabled: boolean
  dry_run: boolean
  counts: Record<string, number>
  items: NotionFieldSyncItem[]
}

export const syncApi = {
  run: async () => {
    const res = await apiClient.post('/sync/run')
    return res.data as { ok: boolean; counters: SyncCounters }
  },
  status: async () => {
    const res = await apiClient.get('/sync/status')
    return res.data as SyncStatusInfo
  },
  submissions: async (params: { status?: string; source?: string; page?: number; size?: number }) => {
    const res = await apiClient.get('/sync/submissions', { params })
    return res.data as { items: IntakeSubmission[]; total: number; page: number; pages: number }
  },
  link: async (submissionId: string, studentId: string) => {
    const res = await apiClient.post(`/sync/submissions/${submissionId}/link`, { student_id: studentId })
    return res.data as IntakeSubmission
  },
  linkAll: async (params?: { status?: string; source?: string }) => {
    const res = await apiClient.post('/sync/submissions/link-all', {
      status: params?.status ?? 'new',
      source: params?.source ?? null,
    })
    return res.data as BulkLinkResult
  },
  ignore: async (submissionId: string) => {
    const res = await apiClient.post(`/sync/submissions/${submissionId}/ignore`)
    return res.data as IntakeSubmission
  },
  createStudent: async (submissionId: string) => {
    const res = await apiClient.post(`/sync/submissions/${submissionId}/create-student`)
    return res.data as { student_id: string; submission: IntakeSubmission }
  },
  createMissing: async () => {
    const res = await apiClient.post('/sync/submissions/create-missing')
    // has_more — проход ограничен потолком (см. services/intake_promote.py),
    // и очередь могла остаться непустой.
    return res.data as { ok: boolean; created: number; skipped: number; has_more: boolean }
  },
  studentIntake: async (studentId: string) => {
    const res = await apiClient.get(`/sync/students/${studentId}/intake`)
    return res.data as StudentIntake
  },
  overview: async () => {
    const res = await apiClient.get('/sync/overview')
    return res.data as Record<string, { has_package: boolean; has_cases: boolean }>
  },
  notionFieldSyncQueue: async () => {
    const res = await apiClient.get('/sync/notion-field-sync')
    return res.data as NotionFieldSyncQueue
  },
  resolveNotionFieldConflict: async (itemId: string, side: 'crm' | 'notion') => {
    const res = await apiClient.post(`/sync/notion-field-sync/${itemId}/resolve`, { side })
    return res.data as { resolved: boolean; side: 'crm' | 'notion'; queued_item_id: string }
  },
}
