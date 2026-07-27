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
  pipeline_status?: PipelineStatus
  intake_year?: number
  degree_level?: string
  scope?: 'all' | 'mine' | 'assigned' | 'unassigned'
  page?: number
  size?: number
  mentor_id?: string
  mzk_manager_id?: string
  lead_mentor_id?: string
  country?: string
  mentor_name?: string
  mzk_name?: string
  service_type?: string
  assignment_role?: string
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

  exportAll: async (): Promise<Blob> => {
    const response = await apiClient.get('/export/students', {
      responseType: 'blob',
    })
    return response.data
  },

  exportOne: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/export/students/${id}`, {
      responseType: 'blob',
    })
    return response.data
  },
}
