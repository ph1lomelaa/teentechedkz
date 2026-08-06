import apiClient from './client'

export type DegreeLevel = 'undergraduate' | 'masters' | 'doctorate'

/** "unknown" is a real state, not a placeholder: fewer than half the catalog
 *  rows matched the finance spreadsheet, and showing those as "no grants"
 *  would mislead a student choosing where to apply. */
export type GrantsStatus = 'yes' | 'no' | 'unknown'

export interface University {
  id: string
  country_ref_id: string | null
  country_name: string | null
  country_flag_emoji?: string
  country_flag_url?: string
  name: string
  city: string
  description: string
  website: string
  world_ranking: number | null
  tuition_range: string
  has_grants: boolean
  has_grants_status?: GrantsStatus
  photo_url?: string | null
  degree_levels?: DegreeLevel[]
  faculties?: string[]
  source_tilda_url?: string | null
}

/** Detail payload — the heavy parsed fields live only here, since the list
 *  endpoint returns the whole table unpaginated. */
export interface UniversityDetail extends University {
  description_full: string
  requirements: Record<string, string[]>
  deadline_note: string
  deadline_year_mentioned: number | null
  grant_note: string
  updated_at: string | null
}

export interface UniversityInput {
  name: string
  country_name?: string | null
  city?: string
  description?: string
  website?: string
  world_ranking?: number | null
  tuition_range?: string
  has_grants?: boolean
  has_grants_status?: GrantsStatus
  grant_note?: string
  photo_url?: string | null
  degree_levels?: DegreeLevel[]
}

export interface UniversityImportJob {
  id: string
  kind: string
  status: 'running' | 'done' | 'failed'
  result?: {
    created: number
    updated: number
    tilda_total: number
    sheet_total: number
    matched: number
    ambiguous_matches: Array<{ tilda_title: string; sheet_name: string; country: string; score: number }>
  }
  error?: string | null
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const universitiesApi = {
  list: () => data<University[]>(apiClient.get('/universities')),
  getById: (id: string) => data<UniversityDetail>(apiClient.get(`/universities/${id}`)),
  create: (body: UniversityInput) => data<University>(apiClient.post('/universities', body)),
  update: (id: string, body: Partial<UniversityInput>) => data<University>(apiClient.patch(`/universities/${id}`, body)),
  remove: (id: string) => apiClient.delete(`/universities/${id}`),
  startImport: (dryRun = false) => data<UniversityImportJob>(apiClient.post('/universities/import/run', null, { params: { dry_run: dryRun } })),
  getImportJob: (jobId: string) => data<UniversityImportJob>(apiClient.get(`/universities/import/${jobId}`)),
}
