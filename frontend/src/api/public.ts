import apiClient from './client'

export interface PublicApplicationInput {
  full_name: string
  phone: string
  email?: string
  city?: string
  degree_level?: string
  intake_year?: number
  target_country?: string
  program_interest?: string
  message?: string
}

export interface PublicApplicationResult {
  id: string
  status: string
  message: string
}

export const publicApi = {
  createApplication: async (body: PublicApplicationInput): Promise<PublicApplicationResult> => {
    const response = await apiClient.post<PublicApplicationResult>('/public/applications', body)
    return response.data
  },
}
