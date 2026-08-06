import apiClient from './client'

export interface EmergencyContact {
  id: string
  student_id: string
  full_name: string
  relation: string | null
  phone: string
  created_at: string
}

export const emergencyContactsApi = {
  list: async (studentId: string): Promise<EmergencyContact[]> => {
    const response = await apiClient.get<EmergencyContact[]>(`/emergency-contacts/student/${studentId}`)
    return response.data
  },
  create: async (studentId: string, data: { full_name: string; relation?: string; phone: string }): Promise<EmergencyContact> => {
    const response = await apiClient.post<EmergencyContact>(`/emergency-contacts/student/${studentId}`, data)
    return response.data
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/emergency-contacts/${id}`)
  },
}
