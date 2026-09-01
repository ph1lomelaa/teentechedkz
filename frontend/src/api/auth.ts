import apiClient from './client'
import { User } from '../types'

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface RefreshResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/login', {
      email,
      password,
    })
    return response.data
  },

  /** Настроен ли вход через Google. Спрашивается до входа, поэтому публично. */
  googleConfig: async (): Promise<{ enabled: boolean; client_id: string | null }> => {
    const response = await apiClient.get<{ enabled: boolean; client_id: string | null }>(
      '/auth/google/config',
    )
    return response.data
  },

  /** Обмен google id_token на нашу сессию. Ответ той же формы, что и у login. */
  loginWithGoogle: async (credential: string): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/google', { credential })
    return response.data
  },

  refresh: async (): Promise<RefreshResponse> => {
    const response = await apiClient.post<RefreshResponse>('/auth/refresh')
    return response.data
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout')
  },

  me: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me')
    return response.data
  },

  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await apiClient.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    })
  },
}
