import apiClient from './client'

export const integrationsApi = {
  getDeepgramToken: async (): Promise<{ access_token: string; expires_in: number }> => {
    const response = await apiClient.post<{ access_token: string; expires_in: number }>(
      '/integrations/deepgram/token',
    )
    return response.data
  },
}
