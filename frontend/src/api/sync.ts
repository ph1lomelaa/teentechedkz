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

export interface SyncStatusInfo {
  configured: boolean
  last_run: {
    at: string | null
    ok: boolean | null
    error: string | null
    counters: Record<string, { total_rows: number; new: number; matched: number }> | null
  }
  new_submissions: number
}

export const syncApi = {
  run: async () => {
    const res = await apiClient.post('/sync/run')
    return res.data as { ok: boolean; counters: Record<string, { total_rows: number; new: number; matched: number }> }
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
    return res.data as { ok: boolean; created: number; skipped: number }
  },
  studentIntake: async (studentId: string) => {
    const res = await apiClient.get(`/sync/students/${studentId}/intake`)
    return res.data as StudentIntake
  },
  overview: async () => {
    const res = await apiClient.get('/sync/overview')
    return res.data as Record<string, { has_package: boolean; has_cases: boolean }>
  },
}
