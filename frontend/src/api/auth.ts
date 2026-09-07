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

export interface LinkedEmail {
  id: string
  email: string
  is_verified: boolean
}

export interface MyEmails {
  primary: string
  extras: LinkedEmail[]
  max_extras: number
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

  /** Свои адреса входа: основной плюс привязанный Google, если он есть. */
  myEmails: async (): Promise<MyEmails> => {
    const response = await apiClient.get<MyEmails>('/auth/me/emails')
    return response.data
  },

  /**
   * Привязать свой Google к текущему аккаунту.
   *
   * Это и есть самообслуживание вместо «забыли пароль?»: почты в системе нет,
   * слать ссылку некуда, а привязав Google один раз, человек входит кнопкой и
   * больше не зависит от того, помнит ли он пароль.
   */
  linkGoogle: async (credential: string): Promise<MyEmails> => {
    const response = await apiClient.post<MyEmails>('/auth/google/link', { credential })
    return response.data
  },

  unlinkEmail: async (emailId: string): Promise<MyEmails> => {
    const response = await apiClient.delete<MyEmails>(`/auth/me/emails/${emailId}`)
    return response.data
  },
}
