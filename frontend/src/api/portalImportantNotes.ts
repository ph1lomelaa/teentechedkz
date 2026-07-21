import apiClient from './client'

export interface PortalImportantNote {
  id: string
  note_text: string
  created_at: string
}

export const portalImportantNotesApi = {
  list: async (): Promise<PortalImportantNote[]> => {
    const response = await apiClient.get<PortalImportantNote[]>('/portal/important-notes')
    return response.data
  },
}
