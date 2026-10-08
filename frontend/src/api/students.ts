import apiClient from './client'
import {
  StudentListItem,
  StudentFull,
  StudentTimelineResponse,
  PaginatedResponse,
  PipelineStatus,
} from '../types'

export interface StudentsQueryParams {
  search?: string
  /** Legacy single-value filter; kept for links/clients deployed earlier. */
  pipeline_status?: PipelineStatus
  /** Comma-separated to keep Axios/FastAPI encoding stable across versions. */
  pipeline_statuses?: string
  pipeline_status_operator?: 'is' | 'is_not'
  intake_year?: number
  degree_level?: string
  scope?: 'all' | 'mine' | 'assigned' | 'unassigned'
  page?: number
  size?: number
  mentor_id?: string
  mzk_manager_id?: string
  lead_mentor_id?: string
  country?: string
  country_primary_only?: boolean
  mentor_name?: string
  mzk_name?: string
  service_type?: string
  /** Роль назначения. Вместе с `mentor_id` — «студенты этого человека именно
   *  как МЗК»; вместе со `scope: 'mine'` — «мои как ментор по УП». */
  assignment_role?: string
  /** Кого забыли назначить на эту роль — переход из колонки «Без
   *  ответственного» на доске распределения. */
  missing_role?: string
}

export interface FacetOption {
  value: string
  count: number
}

export interface PeopleFacetOption {
  key: string
  label: string
  count: number
}

export interface PeopleFacets {
  mentors: PeopleFacetOption[]
  managers: PeopleFacetOption[]
}

export interface StudentFacets {
  years: FacetOption[]
  degrees: FacetOption[]
  statuses: FacetOption[]
  countries: FacetOption[]
}

export interface StudentExportOptions {
  dataset: 'all' | 'notion_active' | 'platform_access' | 'status_mismatch'
  format: 'xlsx' | 'csv' | 'tsv'
  columns: string[]
  require_portal_access?: boolean
  require_chat?: boolean
  require_mzk?: boolean
  require_mentor?: boolean
  student_ids?: string[]
  snapshot_ids?: string[]
  restrict_to_ids?: boolean
  filename?: string
  total_row?: boolean
  split_by?: 'none' | 'intake_year' | 'notion_status' | 'mzk'
  only_active_notion?: boolean
  only_status_mismatch?: boolean
  search?: string
  intake_years?: string[]
  notion_statuses?: string[]
  crm_statuses?: string[]
  degrees?: string[]
  countries?: string[]
  lead_mentors?: string[]
  responsible_role?: string
  responsible_name?: string
  portal_access?: 'any' | 'yes' | 'no'
  active_chat?: 'any' | 'yes' | 'no'
  has_mzk?: 'any' | 'yes' | 'no'
  has_mentor?: 'any' | 'yes' | 'no'
  notion_link?: 'any' | 'yes' | 'no'
  delimiter?: ';' | ',' | '\t'
  bom?: boolean
}

export interface StudentExportPreview {
  count: number
  columns: string[]
  rows: Record<string, string>[]
  groups?: { name: string; count: number; rows: Record<string, string>[] }[]
}

export const studentsApi = {
  list: async (
    params: StudentsQueryParams = {}
  ): Promise<PaginatedResponse<StudentListItem>> => {
    const response = await apiClient.get<PaginatedResponse<StudentListItem>>(
      '/students',
      { params }
    )
    return response.data
  },

  getAll: async (
    params: StudentsQueryParams = {}
  ): Promise<StudentListItem[]> => {
    const response = await apiClient.get<
      PaginatedResponse<StudentListItem> | StudentListItem[]
    >('/students', { params: { ...params, size: 2000 } })
    if (Array.isArray(response.data)) return response.data
    return (response.data as PaginatedResponse<StudentListItem>).items
  },

  get: async (id: string): Promise<StudentFull> => {
    const response = await apiClient.get<StudentFull>(`/students/${id}`)
    return response.data
  },

  timeline: async (
    id: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<StudentTimelineResponse> => {
    const response = await apiClient.get<StudentTimelineResponse>(
      `/students/${id}/timeline`,
      { params }
    )
    return response.data
  },

  create: async (data: Partial<StudentFull>): Promise<StudentFull> => {
    const response = await apiClient.post<StudentFull>('/students', data)
    return response.data
  },

  update: async (
    id: string,
    data: Partial<StudentFull>
  ): Promise<StudentFull> => {
    const response = await apiClient.patch<StudentFull>(`/students/${id}`, data)
    return response.data
  },

  merge: async (
    sourceStudentId: string,
    targetStudentId: string,
  ): Promise<{
    ok: boolean
    source_student_id: string
    target_student_id: string
    moved: Record<string, number>
  }> => {
    const response = await apiClient.post(`/students/${sourceStudentId}/merge`, {
      target_student_id: targetStudentId,
    })
    return response.data
  },

  facets: async (): Promise<StudentFacets> => {
    const response = await apiClient.get<StudentFacets>('/students/facets')
    return response.data
  },

  peopleFacets: async (): Promise<PeopleFacets> => {
    const response = await apiClient.get<PeopleFacets>('/students/people-facets')
    return response.data
  },

  archive: async (id: string): Promise<void> => {
    await apiClient.delete(`/students/${id}`)
  },

  /** Удалить карточку насовсем, со всем зависимым. Необратимо. */
  deletePermanent: async (id: string): Promise<void> => {
    await apiClient.delete(`/students/${id}/permanent`)
  },

  duplicates: async (): Promise<{
    pairs: {
      reason: 'phone' | 'name'
      a: { id: string; full_name: string; phone?: string; intake_year: number }
      b: { id: string; full_name: string; phone?: string; intake_year: number }
    }[]
    total: number
  }> => {
    const response = await apiClient.get('/students/duplicates')
    return response.data
  },

  previewExport: async (options: StudentExportOptions): Promise<StudentExportPreview> => {
    const params = new URLSearchParams()
    params.set('dataset', options.dataset)
    options.columns.forEach((column) => params.append('columns', column))
    options.student_ids?.forEach((id) => params.append('student_ids', id))
    options.snapshot_ids?.forEach((id) => params.append('snapshot_ids', id))
    if (options.restrict_to_ids) params.set('limit_to_ids', 'true')
    if (options.split_by && options.split_by !== 'none') params.set('split_by', options.split_by)
    for (const key of ['require_portal_access', 'require_chat', 'require_mzk', 'require_mentor', 'only_active_notion', 'only_status_mismatch', 'portal_access', 'active_chat', 'has_mzk', 'has_mentor', 'notion_link'] as const) {
      const value = options[key]
      if (value !== undefined && value !== false && value !== 'any') params.set(key, String(value))
    }
    if (options.search) params.set('search', options.search)
    for (const key of ['intake_years', 'notion_statuses', 'crm_statuses', 'degrees', 'countries', 'lead_mentors'] as const) options[key]?.forEach((value) => params.append(key, value))
    if (options.responsible_role) params.set('responsible_role', options.responsible_role)
    if (options.responsible_name) params.set('responsible_name', options.responsible_name)
    const response = await apiClient.get<StudentExportPreview>('/export/students/preview', { params })
    return response.data
  },

  exportAll: async (options?: StudentExportOptions): Promise<{ blob: Blob; count: number | null }> => {
    const params = new URLSearchParams()
    if (options) {
      params.set('dataset', options.dataset)
      params.set('format', options.format)
      options.columns.forEach((column) => params.append('columns', column))
      for (const key of ['require_portal_access', 'require_chat', 'require_mzk', 'require_mentor', 'only_active_notion', 'only_status_mismatch'] as const) {
        if (options[key]) params.set(key, 'true')
      }
      options.student_ids?.forEach((id) => params.append('student_ids', id))
      options.snapshot_ids?.forEach((id) => params.append('snapshot_ids', id))
      if (options.restrict_to_ids) params.set('limit_to_ids', 'true')
      if (options.filename) params.set('filename', options.filename)
      if (options.search) params.set('search', options.search)
      if (options.total_row) params.set('total_row', 'true')
      if (options.split_by && options.split_by !== 'none') params.set('split_by', options.split_by)
      for (const key of ['portal_access', 'active_chat', 'has_mzk', 'has_mentor', 'notion_link'] as const) {
        const value = options[key]
        if (value && value !== 'any') params.set(key, value)
      }
      for (const key of ['intake_years', 'notion_statuses', 'crm_statuses', 'degrees', 'countries', 'lead_mentors'] as const) options[key]?.forEach((value) => params.append(key, value))
      if (options.responsible_role) params.set('responsible_role', options.responsible_role)
      if (options.responsible_name) params.set('responsible_name', options.responsible_name)
      if (options.delimiter) params.set('delimiter', options.delimiter)
      if (options.bom === false) params.set('bom', 'false')
    }
    const response = await apiClient.get('/export/students', {
      responseType: 'blob',
      params,
    })
    const countHeader = response.headers['x-export-count']
    return { blob: response.data, count: countHeader == null ? null : Number(countHeader) }
  },

  exportOne: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/export/students/${id}`, {
      responseType: 'blob',
    })
    return response.data
  },
}
