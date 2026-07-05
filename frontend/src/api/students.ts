import apiClient from './client'
import {
  StudentListItem,
  StudentFull,
  PaginatedResponse,
  PipelineStatus,
} from '../types'

export interface StudentsQueryParams {
  search?: string
  pipeline_status?: PipelineStatus
  intake_year?: number
  page?: number
  size?: number
  mentor_id?: string
  mzk_manager_id?: string
  country?: string
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
    >('/students', { params: { ...params, size: 500 } })
    if (Array.isArray(response.data)) return response.data
    return (response.data as PaginatedResponse<StudentListItem>).items
  },

  get: async (id: string): Promise<StudentFull> => {
    const response = await apiClient.get<StudentFull>(`/students/${id}`)
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
