import apiClient from './client'

export const integrationsApi = {
  getDeepgramToken: async (): Promise<{ access_token: string; expires_in: number }> => {
    const response = await apiClient.post<{ access_token: string; expires_in: number }>(
      '/integrations/deepgram/token',
    )
    return response.data
  },
  zoomStatus: async (): Promise<ZoomStatus> => {
    const response = await apiClient.get<ZoomStatus>('/integrations/zoom/status')
    return response.data
  },
  /** Ссылка на «Разрешить доступ» в Zoom; return_to — куда вернуть ментора. */
  zoomConnect: async (returnTo?: string): Promise<{ authorize_url: string }> => {
    const response = await apiClient.post<{ authorize_url: string }>('/integrations/zoom/connect', { return_to: returnTo })
    return response.data
  },
  zoomDisconnect: async (): Promise<ZoomStatus> => {
    const response = await apiClient.delete<ZoomStatus>('/integrations/zoom')
    return response.data
  },
}

export interface ZoomStatus {
  /** Запись ботом включена на сервере (Meet и Teams работают и без Zoom). */
  bot_enabled: boolean
  /** Подключение Zoom настроено на сервере. */
  available: boolean
  connected: boolean
  state?: string | null
  connected_at?: string | null
}
