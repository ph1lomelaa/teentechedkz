import apiClient from './client'

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
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const universitiesApi = {
  list: () => data<University[]>(apiClient.get('/universities')),
  create: (body: UniversityInput) => data<University>(apiClient.post('/universities', body)),
  update: (id: string, body: Partial<UniversityInput>) => data<University>(apiClient.patch(`/universities/${id}`, body)),
  remove: (id: string) => apiClient.delete(`/universities/${id}`),
}
