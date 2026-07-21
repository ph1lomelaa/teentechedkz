import apiClient from './client'

// Student-safe конспект — the portal never receives the source transcript or
// internal AI fields, only what the manager published.
export interface PortalNote {
  id: string
  title: string
  published_at: string | null
  created_at: string
  summary_markdown?: string
}

export const portalNotesApi = {
  list: () => apiClient.get<PortalNote[]>('/portal/notes').then((r) => r.data),
  get: (id: string) => apiClient.get<PortalNote>(`/portal/notes/${id}`).then((r) => r.data),
}
